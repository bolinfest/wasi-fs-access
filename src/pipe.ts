import { In, Out } from './bindings.js';

export default class Pipe implements In, Out {
  private _data: Array<Uint8Array> = [];
  /** Index of the last byte returned from read(). */
  private _index: [number, number] = [-1, -1];
  private _isWriterClosed = new Deferred();
  private _pendingReads: Array<{
    deferred: Deferred;
    chainedPromise: Promise<Uint8Array>;
  }> = [];

  /**
   * Matches signature of FileSystemWritableFileStream.
   */
  close(): Promise<void> {
    this._isWriterClosed.resolve();
    return this._isWriterClosed.getPromise();
  }

  write(data: Uint8Array): void | Promise<void> {
    if (data.length > 0) {
      this._data.push(new Uint8Array(data));
      const { deferred } = this._pendingReads.shift() ?? {};
      deferred?.resolve();
      // TODO: If there is another link in the chain and we still
      // have data to read, then we should resolve that deferred, too.
    }
  }

  read(len: number): Uint8Array | Promise<Uint8Array> {
    if (this._isWriterClosed.isSettled() || len === 0) {
      return new Uint8Array(0);
    }

    // TODO: Perhaps this should always queue and write() should
    // be responsible for notifying?

    // If there is data to return, then return what we have thus
    // far and let the caller request more data, if desired.
    // (Not clear what the contract of In should be...)
    const readIndex = this._hasDataToRead();
    if (readIndex == null) {
      // There is no data to read. Queue?
      const deferred = new Deferred();
      const chainedPromise = deferred.getPromise().then(() => this.read(len));
      this._pendingReads.push({ deferred, chainedPromise });
      return chainedPromise;
    } else {
      // Lazy implementation: read the rest of what is in the current Uint8Array.
      // Less lazy would be to return as much data (up to `len`) as possible.
      const [index, offset] = readIndex;
      const data = this._data[index];
      const available = data.length - offset;
      const lengthToRead = Math.min(len, available);
      const out = new Uint8Array(data, offset, lengthToRead);
      this._index = [index, offset + lengthToRead - 1];
      return out;
    }
  }

  /**
   * Returns next index to read from if there is data to read or null.
   */
  _hasDataToRead(): [number, number] | null {
    const [index, offset] = this._index;
    if (index === -1) {
      // This is the first read.
      if (this._data.length > 0) {
        return [0, 0];
      } else {
        return null;
      }
    } else if (offset < this._data[index].length - 1) {
      // Still bytes to read in the current array in _data.
      return [index, offset + 1];
    } else if (index === this._data.length - 1) {
      return null;
    } else {
      return [index + 1, 0];
    }
  }
}

class Deferred {
  private _resolve: () => void = () => {};
  private _reject: (error: Error) => void = () => {};
  private _promise: Promise<void>;
  private _isSettled = false;

  constructor() {
    const promise = new Promise<void>((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
    this._promise = promise;
  }

  isSettled(): boolean {
    return this._isSettled;
  }

  getPromise(): Promise<void> {
    return this._promise;
  }

  resolve(): void {
    this._isSettled = true;
    this._resolve();
  }

  reject(error: Error): void {
    this._isSettled = true;
    this._reject(error);
  }
}
