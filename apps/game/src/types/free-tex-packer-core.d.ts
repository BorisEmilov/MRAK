declare module 'free-tex-packer-core' {
  export interface PackInput {
    path: string;
    contents: Buffer;
  }
  export interface PackOutput {
    name: string;
    buffer: Buffer;
  }
  export function packAsync(
    images: PackInput[],
    options: Record<string, unknown>,
  ): Promise<PackOutput[]>;
}
