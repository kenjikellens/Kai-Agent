/**
 * StreamBufferPipeline provides high-throughput token batching and a lookahead settle delay.
 * Buffers incoming LLM tokens in a timestamped FIFO queue to allow trailing markdown delimiters
 * and syntax blocks to settle before committing to the DOM formatter, preventing premature layout shifts.
 */
class StreamBufferPipeline {
    /**
     * Initializes the stream buffer container, lookahead delay, and callbacks.
     * @param {Function} [flushCallback] Callback invoked with committed text on frame/tick.
     * @param {number} [settleDelayMs=180] Lookahead delay in ms to settle markdown delimiters.
     */
    constructor(flushCallback = null, settleDelayMs = 180) {
        this.flushCallback = flushCallback;
        this.settleDelayMs = settleDelayMs;
        this.tokenQueue = [];
        this.committedText = '';
        this.accumulatedText = '';
        this.timerId = null;
    }

    /**
     * Appends a new streaming text token chunk into the lookahead queue and schedules a processing tick.
     * @param {string} chunk New text chunk from LLM stream.
     */
    append(chunk) {
        if (!chunk) return;
        const now = Date.now();
        this.tokenQueue.push({ text: chunk, timestamp: now });
        this.accumulatedText += chunk;

        if (this.timerId === null) {
            this.scheduleTick();
        }
    }

    /**
     * Schedules a timer tick to evaluate settled tokens against the delay window.
     */
    scheduleTick() {
        if (this.timerId !== null) return;
        this.timerId = setTimeout(() => {
            this.timerId = null;
            this.processQueue();
        }, 25);
    }

    /**
     * Processes queued tokens that have settled past the settleDelayMs threshold.
     */
    processQueue() {
        if (this.tokenQueue.length === 0) return;

        const now = Date.now();
        let newCommitted = '';

        while (this.tokenQueue.length > 0) {
            const first = this.tokenQueue[0];
            if (now - first.timestamp >= this.settleDelayMs) {
                newCommitted += first.text;
                this.tokenQueue.shift();
            } else {
                break;
            }
        }

        if (newCommitted.length > 0) {
            this.committedText += newCommitted;
            if (typeof this.flushCallback === 'function') {
                this.flushCallback(this.committedText, newCommitted);
            }
        }

        if (this.tokenQueue.length > 0) {
            this.scheduleTick();
        }
    }

    /**
     * Flushes all remaining queued tokens immediately without waiting for the delay threshold.
     * Invoked when generation completes, a tool starts, or the user interrupts.
     */
    flushImmediate() {
        if (this.timerId !== null) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }

        let newCommitted = '';
        while (this.tokenQueue.length > 0) {
            const item = this.tokenQueue.shift();
            newCommitted += item.text;
        }

        if (newCommitted.length > 0 || this.committedText !== this.accumulatedText) {
            this.committedText = this.accumulatedText;
            if (typeof this.flushCallback === 'function') {
                this.flushCallback(this.committedText, newCommitted);
            }
        }
    }

    /**
     * Resets internal buffers, queues, and cancels pending timer ticks.
     */
    reset() {
        if (this.timerId !== null) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }
        this.tokenQueue = [];
        this.committedText = '';
        this.accumulatedText = '';
    }

    /**
     * Gets total accumulated streaming text so far (including unsettled tokens).
     * @returns {string} Accumulated stream text.
     */
    getAccumulatedText() {
        return this.accumulatedText;
    }

    /**
     * Gets committed text released to the DOM renderer.
     * @returns {string} Committed stream text.
     */
    getCommittedText() {
        return this.committedText;
    }
}
