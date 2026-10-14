import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** Where attachment files live: a local folder in development, Azure Blob Storage in Azure. */
export interface Storage {
  put(key: string, data: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
}

export class LocalStorage implements Storage {
  private readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  private path(key: string): string {
    const path = resolve(join(this.root, key))
    if (!path.startsWith(this.root + '/')) throw new Error(`Invalid storage key: ${key}`)
    return path
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.path(key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, data)
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.path(key))
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true })
  }
}

/**
 * Azure Blob Storage, signed in with the app's managed identity (DefaultAzureCredential reads
 * AZURE_CLIENT_ID), so there's no storage key anywhere.
 */
export class AzureBlobStorage implements Storage {
  private container: Promise<import('@azure/storage-blob').ContainerClient> | null = null

  constructor(
    private readonly accountUrl: string,
    private readonly containerName: string,
  ) {}

  private client() {
    this.container ??= (async () => {
      const { BlobServiceClient } = await import('@azure/storage-blob')
      const { DefaultAzureCredential } = await import('@azure/identity')
      return new BlobServiceClient(this.accountUrl, new DefaultAzureCredential()).getContainerClient(
        this.containerName,
      )
    })()
    return this.container
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const blob = (await this.client()).getBlockBlobClient(key)
    await blob.uploadData(data, { blobHTTPHeaders: { blobContentType: contentType } })
  }

  async get(key: string): Promise<Buffer> {
    return (await this.client()).getBlockBlobClient(key).downloadToBuffer()
  }

  async delete(key: string): Promise<void> {
    await (await this.client()).getBlockBlobClient(key).deleteIfExists()
  }
}

/** Local files in development, Blob Storage when AZURE_STORAGE_ACCOUNT_URL is set. */
export function createStorage(config: {
  STORAGE_DIR: string
  AZURE_STORAGE_ACCOUNT_URL: string
  AZURE_STORAGE_CONTAINER: string
}): Storage {
  return config.AZURE_STORAGE_ACCOUNT_URL
    ? new AzureBlobStorage(config.AZURE_STORAGE_ACCOUNT_URL, config.AZURE_STORAGE_CONTAINER)
    : new LocalStorage(config.STORAGE_DIR)
}
