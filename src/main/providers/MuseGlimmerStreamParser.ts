/**
 * Parser and stream processor for Muse Glimmer models.
 * Handles extracting and transforming reasoning markers:
 * `to=self<|message|>[reasoning]<|eom|><|start|>assistant to=user<|message|>[content]`
 */
export class MuseGlimmerStreamParser {
    private static readonly START_MARKER = 'to=self<|message|>';
    private static readonly FULL_TRANSITION_MARKER = '<|eom|><|start|>assistant to=user<|message|>';
    private static readonly ALT_TRANSITION_MARKER = '<|start|>assistant to=user<|message|>';

    private state: 'INITIAL' | 'IN_THINKING' | 'IN_CONTENT' = 'INITIAL';
    private initialBuffer: string = '';
    private transitionBuffer: string = '';
    private inThinkingTagOpen: boolean = false;
    private readonly thinkingEnabled: boolean;
    private readonly onTokenCallback: (token: string) => void;
    private fullAccumulatedText: string = '';

    /**
     * Creates a new instance of MuseGlimmerStreamParser.
     * @param thinkingEnabled Whether thinking blocks should be emitted.
     * @param onToken Token consumer callback for formatted stream output.
     */
    constructor(thinkingEnabled: boolean = true, onToken: (token: string) => void = () => {}) {
        this.thinkingEnabled = thinkingEnabled;
        this.onTokenCallback = onToken;
    }

    /**
     * Checks whether the given model name is a Muse Glimmer variant.
     * @param model Model identifier string.
     * @returns True if model name matches Muse Glimmer naming patterns.
     */
    public static isMuseGlimmerModel(model?: string): boolean {
        if (!model) return false;
        const lower = model.toLowerCase();
        return lower.includes('muse') || lower.includes('glimmer');
    }

    /**
     * Determines whether raw text contains Muse Glimmer formatting markers.
     * @param text Raw response text to test.
     * @returns True if Muse Glimmer markers are detected.
     */
    public static hasMuseGlimmerMarkers(text: string): boolean {
        if (!text) return false;
        return text.includes('to=self<|message|>') || text.includes('assistant to=user<|message|>');
    }

    /**
     * Parses a complete non-streaming response string from a Muse Glimmer model.
     * Converts to `<think>...</think>` standard tags or strips reasoning if thinking is disabled.
     * @param rawText Complete raw response string.
     * @param thinkingEnabled Whether reasoning tags and content should be retained.
     * @returns Formatted output string.
     */
    public static parseCompleteResponse(rawText: string, thinkingEnabled: boolean = true): string {
        if (!rawText) return '';

        const startIdx = rawText.indexOf(MuseGlimmerStreamParser.START_MARKER);
        if (startIdx === -1) {
            // Check if there's an assistant transition marker even without the start marker
            const transitionMatch = rawText.match(/(?:<\|eom\|>)?(?:\s*)<\|start\|>assistant to=user<\|message\|>/);
            if (transitionMatch && transitionMatch.index !== undefined) {
                const thought = rawText.substring(0, transitionMatch.index).trim();
                const answer = rawText.substring(transitionMatch.index + transitionMatch[0].length);
                if (thought) {
                    return thinkingEnabled ? `<think>${thought}</think>${answer}` : answer;
                }
                return answer;
            }
            return rawText;
        }

        const afterStart = rawText.substring(startIdx + MuseGlimmerStreamParser.START_MARKER.length);
        const prefix = rawText.substring(0, startIdx);

        // Match compound transition marker first
        const compoundMatch = afterStart.match(/(?:<\|eom\|>)?(?:\s*)<\|start\|>assistant to=user<\|message\|>/);
        if (compoundMatch && compoundMatch.index !== undefined) {
            const thought = afterStart.substring(0, compoundMatch.index).trim();
            const answer = afterStart.substring(compoundMatch.index + compoundMatch[0].length);
            if (thinkingEnabled) {
                return `${prefix}<think>${thought}</think>${answer}`;
            } else {
                return `${prefix}${answer}`;
            }
        }

        // Check standalone <|eom|>
        const eomIdx = afterStart.indexOf('<|eom|>');
        if (eomIdx !== -1) {
            const thought = afterStart.substring(0, eomIdx).trim();
            const answer = afterStart.substring(eomIdx + '<|eom|>'.length);
            if (thinkingEnabled) {
                return `${prefix}<think>${thought}</think>${answer}`;
            } else {
                return `${prefix}${answer}`;
            }
        }

        // Only thought present
        const thought = afterStart.trim();
        if (thinkingEnabled) {
            return `${prefix}<think>${thought}</think>`;
        } else {
            return prefix;
        }
    }

    /**
     * Processes an incoming streaming text chunk.
     * @param chunk Raw chunk string from stream delta.
     */
    public processChunk(chunk: string): void {
        if (!chunk) return;

        if (this.state === 'INITIAL') {
            this.initialBuffer += chunk;
            const marker = MuseGlimmerStreamParser.START_MARKER;

            // Check if marker matches completely
            if (this.initialBuffer.includes(marker)) {
                const markerIndex = this.initialBuffer.indexOf(marker);
                const prefix = this.initialBuffer.substring(0, markerIndex);
                if (prefix) {
                    this.emitContent(prefix);
                }
                const remainder = this.initialBuffer.substring(markerIndex + marker.length);
                this.initialBuffer = '';
                this.startThinking();
                if (remainder) {
                    this.processThinkingChunk(remainder);
                }
            } else if (marker.startsWith(this.initialBuffer)) {
                // Potential partial match of the start marker, wait for more chunks
                return;
            } else {
                // Not starting with Muse Glimmer start marker
                // Check if any partial start marker is at the end of initialBuffer
                let matchedPartial = false;
                for (let i = 1; i < marker.length; i++) {
                    const sub = marker.substring(0, i);
                    if (this.initialBuffer.endsWith(sub)) {
                        const safePrefix = this.initialBuffer.substring(0, this.initialBuffer.length - sub.length);
                        if (safePrefix) {
                            this.emitContent(safePrefix);
                        }
                        this.initialBuffer = sub;
                        matchedPartial = true;
                        break;
                    }
                }

                if (!matchedPartial) {
                    const toFlush = this.initialBuffer;
                    this.initialBuffer = '';
                    this.state = 'IN_CONTENT';
                    this.emitContent(toFlush);
                }
            }
        } else if (this.state === 'IN_THINKING') {
            this.processThinkingChunk(chunk);
        } else if (this.state === 'IN_CONTENT') {
            this.emitContent(chunk);
        }
    }

    /**
     * Handles chunk ingestion while inside the thinking state.
     * @param chunk Raw thinking delta chunk.
     */
    private processThinkingChunk(chunk: string): void {
        this.transitionBuffer += chunk;

        const fullMarkers = [
            MuseGlimmerStreamParser.FULL_TRANSITION_MARKER,
            '<|eom|>\n' + MuseGlimmerStreamParser.ALT_TRANSITION_MARKER,
            MuseGlimmerStreamParser.ALT_TRANSITION_MARKER
        ];

        for (const marker of fullMarkers) {
            const idx = this.transitionBuffer.indexOf(marker);
            if (idx !== -1) {
                const thoughtBefore = this.transitionBuffer.substring(0, idx);
                if (thoughtBefore) {
                    this.emitThinking(thoughtBefore);
                }
                const remainder = this.transitionBuffer.substring(idx + marker.length);
                this.transitionBuffer = '';
                this.endThinking();
                if (remainder) {
                    this.emitContent(remainder);
                }
                return;
            }
        }

        // Check if the end of transitionBuffer is a prefix of any fullMarker
        let longestPartialLen = 0;
        for (const marker of fullMarkers) {
            for (let len = Math.min(marker.length - 1, this.transitionBuffer.length); len > longestPartialLen; len--) {
                const sub = marker.substring(0, len);
                if (this.transitionBuffer.endsWith(sub)) {
                    longestPartialLen = len;
                }
            }
        }

        if (longestPartialLen > 0) {
            const safeToEmit = this.transitionBuffer.substring(0, this.transitionBuffer.length - longestPartialLen);
            this.transitionBuffer = this.transitionBuffer.substring(this.transitionBuffer.length - longestPartialLen);
            if (safeToEmit) {
                this.emitThinking(safeToEmit);
            }
        } else {
            const safeToEmit = this.transitionBuffer;
            this.transitionBuffer = '';
            if (safeToEmit) {
                this.emitThinking(safeToEmit);
            }
        }
    }

    /**
     * Begins the thinking block.
     */
    private startThinking(): void {
        this.state = 'IN_THINKING';
        if (this.thinkingEnabled) {
            this.inThinkingTagOpen = true;
            this.fullAccumulatedText += '<think>';
            this.onTokenCallback('<think>');
        }
    }

    /**
     * Ends the thinking block and transitions to content mode.
     */
    private endThinking(): void {
        if (this.inThinkingTagOpen && this.thinkingEnabled) {
            this.fullAccumulatedText += '</think>';
            this.onTokenCallback('</think>');
            this.inThinkingTagOpen = false;
        }
        this.state = 'IN_CONTENT';
    }

    /**
     * Emits a thinking token fragment.
     * @param token Thinking string fragment.
     */
    private emitThinking(token: string): void {
        if (this.thinkingEnabled) {
            this.fullAccumulatedText += token;
            this.onTokenCallback(token);
        }
    }

    /**
     * Emits an assistant content token fragment.
     * @param token Content string fragment.
     */
    private emitContent(token: string): void {
        this.fullAccumulatedText += token;
        this.onTokenCallback(token);
    }

    /**
     * Completes the stream parsing and flushes any pending buffers.
     * @returns The total accumulated text string formatted with think tags.
     */
    public finish(): string {
        if (this.initialBuffer) {
            if (this.state === 'INITIAL') {
                this.emitContent(this.initialBuffer);
            }
            this.initialBuffer = '';
        }

        if (this.transitionBuffer) {
            if (this.transitionBuffer === '<|eom|>' || this.transitionBuffer.startsWith('<|eom|>')) {
                const eomIndex = this.transitionBuffer.indexOf('<|eom|>');
                const thought = this.transitionBuffer.substring(0, eomIndex);
                const afterEom = this.transitionBuffer.substring(eomIndex + '<|eom|>'.length);
                if (thought) {
                    this.emitThinking(thought);
                }
                this.endThinking();
                if (afterEom) {
                    this.emitContent(afterEom);
                }
            } else {
                if (this.state === 'IN_THINKING') {
                    this.emitThinking(this.transitionBuffer);
                } else {
                    this.emitContent(this.transitionBuffer);
                }
            }
            this.transitionBuffer = '';
        }

        if (this.inThinkingTagOpen && this.thinkingEnabled) {
            this.fullAccumulatedText += '</think>';
            this.onTokenCallback('</think>');
            this.inThinkingTagOpen = false;
        }

        return this.fullAccumulatedText;
    }
}
