# Postcode Search Web Interface

This is a modern web interface for searching UK postcodes built with Vite, TypeScript, and Tailwind CSS.

## Features

- **Real-time search**: Type partial or full postcodes to get instant results
- **Responsive design**: Works on desktop and mobile devices
- **Fast performance**: Uses the optimized binary postcode database
- **Modern UI**: Clean, accessible interface with Tailwind CSS
- **Geographic data**: Shows latitude/longitude coordinates for each postcode
- **Map integration**: Direct links to Google Maps for each result

## Development

```bash
# Start development server
yarn dev

# Build for production
yarn build:web

# Preview production build
yarn preview
```

## Usage

1. **Full postcode search**: Enter a complete postcode like "SW1A 1AA" to find its exact coordinates
2. **Partial search**: Enter partial postcodes like "SW1A" or "SW1" to see all matching postcodes
3. **Interactive results**: Click "View on Map" to open the location in Google Maps

## Technical Details

- Built with **Vite** for fast development and optimized builds
- Uses **TypeScript** for type safety
- **Tailwind CSS** for styling with CDN delivery
- **Font Awesome** icons for better UX
- Browser-compatible **Buffer polyfill** for Node.js compatibility
- Optimized for **GitHub Pages** deployment

## Browser Compatibility

- Modern browsers (Chrome, Firefox, Safari, Edge)
- Mobile browsers (iOS Safari, Chrome Mobile)
- No Internet Explorer support (uses modern JavaScript features)
