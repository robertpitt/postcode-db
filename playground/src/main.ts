import './buffer-polyfill'
import { PostcodeClient } from '../../src/PostcodeClient'
import { PostcodeLookupResult } from '../../src/types'
import './style.css'

class PostcodeSearchApp {
  private client: PostcodeClient | null = null
  private searchInput: HTMLInputElement
  private resultsContainer: HTMLElement
  private loadingIndicator: HTMLElement
  private errorMessage: HTMLElement
  private statsContainer: HTMLElement

  constructor() {
    this.initializeUI()
    this.loadDatabase()
  }

  private initializeUI() {
    const app = document.querySelector<HTMLDivElement>('#app')!
    
    app.innerHTML = `
      <div class="container mx-auto px-4 py-8 max-w-4xl">
        <!-- Header -->
        <div class="text-center mb-8">
          <h1 class="text-4xl font-bold text-gray-900 mb-2">
            <i class="fas fa-map-marker-alt text-blue-600"></i>
            UK Postcode Search
          </h1>
          <p class="text-gray-600">Search for UK postcodes and find their coordinates</p>
        </div>

        <!-- Search Section -->
        <div class="bg-white rounded-lg shadow-md p-6 mb-6">
          <div class="flex flex-col md:flex-row gap-4">
            <div class="flex-1">
              <label for="postcode-input" class="block text-sm font-medium text-gray-700 mb-2">
                Enter Postcode or Partial Postcode
              </label>
              <div class="relative">
                <input
                  type="text"
                  id="postcode-input"
                  class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
                  placeholder="e.g., SW1A 1AA, SW1A, or SW1"
                  autocomplete="off"
                >
                <i class="fas fa-search absolute right-3 top-3 text-gray-400"></i>
              </div>
            </div>
          </div>
          
          <!-- Loading Indicator -->
          <div id="loading" class="hidden mt-4 text-center">
            <i class="fas fa-spinner fa-spin text-blue-600"></i>
            <span class="ml-2 text-gray-600">Loading database...</span>
          </div>
          
          <!-- Error Message -->
          <div id="error" class="hidden mt-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
            <i class="fas fa-exclamation-triangle mr-2"></i>
            <span id="error-text"></span>
          </div>
          
          <!-- Stats -->
          <div id="stats" class="hidden mt-4 text-sm text-gray-600"></div>
        </div>

        <!-- Results Section -->
        <div id="results-container" class="hidden">
          <div class="bg-white rounded-lg shadow-md">
            <div class="px-6 py-4 border-b border-gray-200">
              <h2 class="text-xl font-semibold text-gray-900">
                <i class="fas fa-list mr-2"></i>
                Search Results
              </h2>
            </div>
            <div id="results" class="divide-y divide-gray-200"></div>
          </div>
        </div>

        <!-- Instructions -->
        <div class="mt-8 bg-blue-50 rounded-lg p-6">
          <h3 class="text-lg font-semibold text-blue-900 mb-3">
            <i class="fas fa-info-circle mr-2"></i>
            How to use
          </h3>
          <ul class="text-blue-800 space-y-2">
            <li><i class="fas fa-check mr-2"></i> Enter a full postcode (e.g., "SW1A 1AA") to find its exact coordinates</li>
            <li><i class="fas fa-check mr-2"></i> Enter a partial postcode (e.g., "SW1A" or "SW1") to see all matching postcodes</li>
            <li><i class="fas fa-check mr-2"></i> Results show latitude, longitude, and can be used with mapping services</li>
          </ul>
        </div>
      </div>
    `

    // Get references to DOM elements
    this.searchInput = document.getElementById('postcode-input') as HTMLInputElement
    this.resultsContainer = document.getElementById('results-container') as HTMLElement
    this.loadingIndicator = document.getElementById('loading') as HTMLElement
    this.errorMessage = document.getElementById('error') as HTMLElement
    this.statsContainer = document.getElementById('stats') as HTMLElement

    // Add event listeners
    this.searchInput.addEventListener('input', this.handleSearch.bind(this))
    this.searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.handleSearch()
      }
    })
  }

  private async loadDatabase() {
    try {
      this.showLoading('Loading postcode database...')
      
      // Fetch the database file from GitHub
      const response = await fetch('https://raw.githubusercontent.com/robertpitt/postcode-db/main/postcodes.pcod')
      if (!response.ok) {
        throw new Error(`Failed to load database: ${response.statusText}`)
      }
      
      const arrayBuffer = await response.arrayBuffer()
      const buffer = new Uint8Array(arrayBuffer)
      
      // Create PostcodeClient with polyfilled Buffer
      this.client = new PostcodeClient((window as any).Buffer.from(buffer))
      
      // Show stats
      const stats = this.client.getStats()
      this.showStats(stats)
      
      this.hideLoading()
      this.searchInput.disabled = false
      this.searchInput.focus()
      
    } catch (error) {
      console.error('Failed to load database:', error)
      this.showError(`Failed to load postcode database: ${error instanceof Error ? error.message : 'Unknown error'}`)
      this.hideLoading()
    }
  }

  private handleSearch() {
    if (!this.client) {
      this.showError('Database not loaded yet. Please wait...')
      return
    }

    const query = this.searchInput.value.trim().toUpperCase()
    
    if (!query) {
      this.hideResults()
      return
    }

    try {
      let results: PostcodeLookupResult[] = []
      
      // Try exact lookup first
      const exactResult = this.client.lookup(query)
      if (exactResult) {
        results = [exactResult]
      } else {
        // Try partial search - find outwards that match
        const matchingOutwards = this.client.findNearbyOutwards(query)
        
        // Get all postcodes for matching outwards (limit to prevent overwhelming)
        for (const outward of matchingOutwards.slice(0, 5)) {
          const outwardResults = this.client.enumerateOutward(outward)
          results.push(...outwardResults.slice(0, 50)) // Limit per outward
        }
        
        // If no outward matches, try as a prefix of individual postcodes
        if (results.length === 0) {
          // This is a more expensive operation, so we limit it
          const allOutwards = this.client.getOutwardList()
          for (const outward of allOutwards.slice(0, 10)) {
            const outwardResults = this.client.enumerateOutward(outward)
            const filtered = outwardResults.filter(result => 
              result.postcode.replace(/\s/g, '').startsWith(query.replace(/\s/g, ''))
            )
            results.push(...filtered.slice(0, 20))
            if (results.length > 100) break // Prevent too many results
          }
        }
      }
      
      this.showResults(results, query)
      
    } catch (error) {
      console.error('Search error:', error)
      this.showError(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private showResults(results: PostcodeLookupResult[], query: string) {
    const resultsElement = document.getElementById('results')!
    
    if (results.length === 0) {
      resultsElement.innerHTML = `
        <div class="p-6 text-center text-gray-500">
          <i class="fas fa-search text-4xl mb-4"></i>
          <p class="text-lg">No postcodes found for "${query}"</p>
          <p class="text-sm mt-2">Try a different search term or check your spelling</p>
        </div>
      `
    } else {
      const resultItems = results.map(result => `
        <div class="p-4 hover:bg-gray-50 transition-colors">
          <div class="flex flex-col md:flex-row md:items-center md:justify-between">
            <div class="flex-1">
              <div class="font-semibold text-lg text-gray-900">${result.postcode}</div>
              ${result.outward ? `<div class="text-sm text-gray-500">Outward: ${result.outward}</div>` : ''}
            </div>
            <div class="mt-2 md:mt-0 md:text-right">
              <div class="text-sm text-gray-600">
                <i class="fas fa-map-pin mr-1"></i>
                Lat: ${result.lat.toFixed(6)}, Lon: ${result.lon.toFixed(6)}
              </div>
              <div class="mt-1">
                <a 
                  href="https://www.google.com/maps?q=${result.lat},${result.lon}" 
                  target="_blank"
                  class="inline-flex items-center px-3 py-1 text-xs bg-blue-100 text-blue-800 rounded-full hover:bg-blue-200 transition-colors"
                >
                  <i class="fas fa-external-link-alt mr-1"></i>
                  View on Map
                </a>
              </div>
            </div>
          </div>
        </div>
      `).join('')
      
      resultsElement.innerHTML = resultItems
    }
    
    this.resultsContainer.classList.remove('hidden')
  }

  private hideResults() {
    this.resultsContainer.classList.add('hidden')
  }

  private showLoading(message: string) {
    this.loadingIndicator.querySelector('span')!.textContent = message
    this.loadingIndicator.classList.remove('hidden')
  }

  private hideLoading() {
    this.loadingIndicator.classList.add('hidden')
  }

  private showError(message: string) {
    const errorText = document.getElementById('error-text')!
    errorText.textContent = message
    this.errorMessage.classList.remove('hidden')
  }

  private showStats(stats: { totalOutwards: number; totalPostcodes: number; fileSize: number }) {
    this.statsContainer.innerHTML = `
      <i class="fas fa-database mr-2"></i>
      Database loaded: ${stats.totalOutwards.toLocaleString()} outward codes, 
      ${stats.totalPostcodes.toLocaleString()} postcodes 
      (${(stats.fileSize / 1024 / 1024).toFixed(1)} MB)
    `
    this.statsContainer.classList.remove('hidden')
  }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PostcodeSearchApp()
})
