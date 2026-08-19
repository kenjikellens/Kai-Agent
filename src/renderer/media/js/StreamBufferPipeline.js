/**
 * StreamBufferPipeline provides high-throughput requestAnimationFrame token batching.
 * Buffers incoming LLM tokens in memory and flushes a single DOM update per frame (60 FPS).
 */
class StreamBufferPipeline {
    /**
     * Initializes the stream buffer container and callbacks.
     * @param {Function} [flushCallback] Callback invoked with accumulated text on animation frame.
     */
    constructor(flushCallback = null) {
        this.flushCallback = flushCallback;
        this.buffer = '';
        this.accumulatedText = '';
        this.isRafScheduled = false;
        this.rafId = null;
    }

    /**
     * Appends a new streaming text token chunk into the buffer and schedules a frame flush.
     * @param {string} chunk New text chunk from LLM stream.
     */
    append(chunk) {
        if (!chunk) return;
        this.buffer += chunk;
        this.accumulatedText += chunk;

        if (!this.isRafScheduled) {
            this.isRafScheduled = true;
            this.rafId = requestAnimationFrame(() => this.flush());
        }
    }

    /**
     * Flushes buffered text immediately to the registered callback.
     */
    flush() {
        this.isRafScheduled = false;
        this.rafId = null;
        if (typeof this.flushCallback === 'function') {
            this.flushCallback(this.accumulatedText, this.buffer);
        }
        this.buffer = '';
    }

    /**
     * Flushes any remaining tokens immediately without waiting for the next animation frame.
     */
    flushImmediate() {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.flush();
    }

    /**
     * Resets internal buffers and cancels pending animation frames.
     */
    reset() {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.buffer = '';
        this.accumulatedText = '';
        this.isRafScheduled = false;
    }

    /**
     * Gets total accumulated streaming text so far.
     * @returns {string} Accumulated stream text.
     */
    getAccumulatedText() {
        return this.accumulatedText;
    }
}
