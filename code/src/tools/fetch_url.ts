import * as http from 'http';
import * as https from 'https';
import { Tool, ToolContext, FunctionDeclaration } from './Tool';

/**
 * Tool for fetching web page or raw API documentation content from a HTTP/HTTPS URL.
 */
export class FetchUrlTool extends Tool {
    public readonly name = 'fetch_url';
    public readonly description = 'Fetches raw text content from a web URL for documentation or reference.';

    public getFunctionDeclaration(): FunctionDeclaration {
        return {
            type: 'function',
            function: {
                name: this.name,
                description: this.description,
                parameters: {
                    type: 'object',
                    properties: {
                        url: {
                            type: 'string',
                            description: 'Full HTTP or HTTPS URL to fetch.'
                        }
                    },
                    required: ['url']
                }
            }
        };
    }

    /**
     * Executes the URL fetch operation.
     * @param args Arguments containing target URL.
     * @param _context Execution context.
     * @returns Raw response text.
     */
    public async execute(args: { url: string }, _context: ToolContext): Promise<string> {
        if (!args.url || (!args.url.startsWith('http://') && !args.url.startsWith('https://'))) {
            return 'Error: Invalid URL. Must start with http:// or https://';
        }

        return new Promise((resolve) => {
            try {
                const parsedUrl = new URL(args.url);
                const clientModule = parsedUrl.protocol === 'https:' ? https : http;

                const req = clientModule.get(args.url, { timeout: 8000 }, (res) => {
                    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        // Follow single redirect
                        this.execute({ url: res.headers.location }, _context).then(resolve);
                        return;
                    }

                    let data = '';
                    res.on('data', (chunk) => { data += chunk; });
                    res.on('end', () => {
                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            // Strip HTML tags if HTML page
                            let cleanText = data;
                            if (res.headers['content-type']?.includes('html')) {
                                cleanText = data.replace(/<script\b[^<]*>([\s\S]*?)<\/script>/gi, '')
                                                .replace(/<style\b[^<]*>([\s\S]*?)<\/style>/gi, '')
                                                .replace(/<[^>]+>/g, ' ')
                                                .replace(/\s+/g, ' ');
                            }
                            resolve(this.truncateOutput(cleanText.trim()));
                        } else {
                            resolve(`HTTP Error ${res.statusCode}: Failed to fetch URL.`);
                        }
                    });
                });

                req.on('error', (err) => resolve(`Fetch error: ${err.message}`));
                req.on('timeout', () => { req.destroy(); resolve('Fetch error: Connection timed out after 8s'); });
            } catch (e: any) {
                resolve(`URL parsing error: ${e.message || e}`);
            }
        });
    }
}
