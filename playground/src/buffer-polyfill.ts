/**
 * Simple Buffer polyfill for browser compatibility
 * This provides the minimal Buffer interface needed by PostcodeClient
 */

export class BufferPolyfill {
  private data: Uint8Array;

  constructor(data: Uint8Array | ArrayBuffer | number[]) {
    if (data instanceof ArrayBuffer) {
      this.data = new Uint8Array(data);
    } else if (Array.isArray(data)) {
      this.data = new Uint8Array(data);
    } else {
      this.data = data;
    }

    // Make it behave like an array for buffer[index] access
    return new Proxy(this, {
      get(target, prop) {
        if (typeof prop === "string" && /^\d+$/.test(prop)) {
          const index = parseInt(prop, 10);
          return target.data[index];
        }
        return (target as any)[prop];
      },
      has(target, prop) {
        if (typeof prop === "string" && /^\d+$/.test(prop)) {
          const index = parseInt(prop, 10);
          return index >= 0 && index < target.data.length;
        }
        return prop in target;
      },
    });
  }

  static from(data: Uint8Array | ArrayBuffer | number[]): BufferPolyfill {
    return new BufferPolyfill(data);
  }

  static alloc(size: number, fill?: number): BufferPolyfill {
    const data = new Uint8Array(size);
    if (fill !== undefined) {
      data.fill(fill);
    }
    return new BufferPolyfill(data);
  }

  static concat(buffers: BufferPolyfill[]): BufferPolyfill {
    const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;

    for (const buffer of buffers) {
      result.set(buffer.data, offset);
      offset += buffer.length;
    }

    return new BufferPolyfill(result);
  }

  get length(): number {
    return this.data.length;
  }

  readUInt8(offset: number): number {
    return this.data[offset] || 0;
  }

  readUInt16LE(offset: number): number {
    return (this.data[offset] || 0) | ((this.data[offset + 1] || 0) << 8);
  }

  readUInt32LE(offset: number): number {
    return (
      ((this.data[offset] || 0) |
        ((this.data[offset + 1] || 0) << 8) |
        ((this.data[offset + 2] || 0) << 16) |
        ((this.data[offset + 3] || 0) << 24)) >>>
      0
    ); // Convert to unsigned 32-bit
  }

  readInt32LE(offset: number): number {
    const value = this.readUInt32LE(offset);
    // Convert unsigned to signed
    return value > 0x7fffffff ? value - 0x100000000 : value;
  }

  readUIntLE(offset: number, byteLength: number): number {
    let value = 0;
    for (let i = 0; i < byteLength; i++) {
      value |= (this.data[offset + i] || 0) << (i * 8);
    }
    return value >>> 0;
  }

  readIntLE(offset: number, byteLength: number): number {
    const value = this.readUIntLE(offset, byteLength);
    const maxValue = Math.pow(2, byteLength * 8 - 1);
    return value >= maxValue ? value - Math.pow(2, byteLength * 8) : value;
  }

  toString(encoding: string, start?: number, end?: number): string {
    const slice = this.data.slice(start, end);
    if (encoding === "ascii") {
      return String.fromCharCode(...slice);
    }
    throw new Error(`Encoding ${encoding} not supported`);
  }

  subarray(start?: number, end?: number): Uint8Array {
    return this.data.subarray(start, end);
  }
}

// Make Buffer available globally for the postcode client
declare global {
  interface Window {
    Buffer: typeof BufferPolyfill;
  }
}

if (typeof window !== "undefined") {
  window.Buffer = BufferPolyfill as any;
}
