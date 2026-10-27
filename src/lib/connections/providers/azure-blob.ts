import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import { FileTooLargeError, fileName, scopedPath, type AzureBlobConfig, type AzureBlobSecret, type BrowseResult, type StorageProvider } from '../types';

// Azure Blob Storage with a connection string. The string is checked before it is stored
// (parseAzureConnectionString) so it can only reach an Azure blob endpoint. Read-only: list and
// download blobs.

export function azureBlobProvider(
  config: AzureBlobConfig,
  secret: AzureBlobSecret,
  makeContainer = (cs: string, container: string): ContainerClient => BlobServiceClient.fromConnectionString(cs).getContainerClient(container),
): StorageProvider {
  const container = makeContainer(secret.connectionString, config.container);
  const root = config.rootFolder;

  const page = async (prefix: string, max: number) => {
    const iter = container.listBlobsByHierarchy('/', { prefix: prefix || undefined }).byPage({ maxPageSize: max });
    const next = await iter.next();
    return next.done ? null : next.value;
  };

  return {
    async test() {
      const prefix = root ? `${root}/` : '';
      const p = await page(prefix, 1);
      const count = (p?.segment.blobItems.length ?? 0) + (p?.segment.blobPrefixes?.length ?? 0);
      const where = `${config.accountName ?? 'account'}/${config.container}/${prefix}`;
      return count ? `Connected to ${where}` : `Connected to ${where} (no blobs yet)`;
    },

    async list(path, max): Promise<BrowseResult> {
      const full = scopedPath(root, path);
      const prefix = full ? `${full}/` : '';
      const p = await page(prefix, max);
      const rel = (name: string) => (root ? name.slice(root.length + 1) : name);
      const folders = (p?.segment.blobPrefixes ?? []).map((b) => {
        const name = b.name.replace(/\/$/, '');
        return { name: name.split('/').pop()!, path: rel(name), isFolder: true };
      });
      const files = (p?.segment.blobItems ?? []).map((b) => ({
        name: b.name.split('/').pop()!,
        path: rel(b.name),
        isFolder: false,
        size: b.properties.contentLength,
        modified: b.properties.lastModified?.toISOString(),
      }));
      return { path: path.replace(/^\/+|\/+$/g, ''), items: [...folders, ...files], truncated: !!p?.continuationToken };
    },

    async read(path, maxBytes) {
      const name = scopedPath(root, path);
      const blob = container.getBlobClient(name);
      const props = await blob.getProperties();
      if ((props.contentLength ?? 0) > maxBytes) throw new FileTooLargeError(fileName(name), props.contentLength!, maxBytes);
      const buffer = await blob.downloadToBuffer();
      return { name: fileName(name), bytes: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength), contentType: props.contentType };
    },
  };
}
