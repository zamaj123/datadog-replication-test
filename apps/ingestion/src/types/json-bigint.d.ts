declare module "json-bigint" {
  interface JsonBigIntOptions {
    useNativeBigInt?: boolean;
  }

  interface JsonBigIntInstance {
    parse(text: string): unknown;
    stringify(value: unknown): string;
  }

  export default function JSONBigFactory(options?: JsonBigIntOptions): JsonBigIntInstance;
}
