/** Converts an OpenAI-style JSON schema to Gemini's Schema representation. */
export function toGeminiSchema(schema: any): any {
    if (!schema || typeof schema !== 'object') return schema;

    const converted: any = {};
    for (const key of ['description', 'required', 'enum', 'format', 'nullable']) {
        if (schema[key] !== undefined) converted[key] = schema[key];
    }

    if (schema.type) converted.type = String(schema.type).toUpperCase();
    if (schema.properties && typeof schema.properties === 'object') {
        converted.properties = Object.fromEntries(
            Object.entries(schema.properties).map(([name, value]) => [name, toGeminiSchema(value)])
        );
    }
    if (schema.items) converted.items = toGeminiSchema(schema.items);
    return converted;
}
