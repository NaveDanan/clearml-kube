import { createClient } from './server';

export type StorageBucket = 'pipelines' | 'datasets' | 'models' | 'reports';

/**
 * Upload a file to Supabase storage
 */
export async function uploadFile(
  bucket: StorageBucket,
  path: string,
  file: File | Blob,
  options?: {
    contentType?: string;
    upsert?: boolean;
  }
) {
  const supabase = await createClient();
  
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, file, {
      contentType: options?.contentType,
      upsert: options?.upsert ?? false,
    });
  
  if (error) throw error;
  
  return data;
}

/**
 * Download a file from Supabase storage
 */
export async function downloadFile(bucket: StorageBucket, path: string) {
  const supabase = await createClient();
  
  const { data, error } = await supabase.storage
    .from(bucket)
    .download(path);
  
  if (error) throw error;
  
  return data;
}

/**
 * Get a public URL for a file
 */
export async function getPublicUrl(bucket: StorageBucket, path: string) {
  const supabase = await createClient();
  
  const { data } = supabase.storage
    .from(bucket)
    .getPublicUrl(path);
  
  return data.publicUrl;
}

/**
 * Get a signed URL for temporary access to a private file
 */
export async function getSignedUrl(
  bucket: StorageBucket,
  path: string,
  expiresIn = 3600 // 1 hour default
) {
  const supabase = await createClient();
  
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);
  
  if (error) throw error;
  
  return data.signedUrl;
}

/**
 * List files in a bucket/folder
 */
export async function listFiles(
  bucket: StorageBucket,
  folder?: string,
  options?: {
    limit?: number;
    offset?: number;
    search?: string;
  }
) {
  const supabase = await createClient();
  
  const { data, error } = await supabase.storage
    .from(bucket)
    .list(folder, {
      limit: options?.limit ?? 100,
      offset: options?.offset ?? 0,
      search: options?.search,
    });
  
  if (error) throw error;
  
  return data;
}

/**
 * Delete a file from storage
 */
export async function deleteFile(bucket: StorageBucket, path: string) {
  const supabase = await createClient();
  
  const { error } = await supabase.storage
    .from(bucket)
    .remove([path]);
  
  if (error) throw error;
}

/**
 * Delete multiple files from storage
 */
export async function deleteFiles(bucket: StorageBucket, paths: string[]) {
  const supabase = await createClient();
  
  const { error } = await supabase.storage
    .from(bucket)
    .remove(paths);
  
  if (error) throw error;
}

/**
 * Move/rename a file
 */
export async function moveFile(
  bucket: StorageBucket,
  fromPath: string,
  toPath: string
) {
  const supabase = await createClient();
  
  const { error } = await supabase.storage
    .from(bucket)
    .move(fromPath, toPath);
  
  if (error) throw error;
}

/**
 * Copy a file
 */
export async function copyFile(
  bucket: StorageBucket,
  fromPath: string,
  toPath: string
) {
  const supabase = await createClient();
  
  const { error } = await supabase.storage
    .from(bucket)
    .copy(fromPath, toPath);
  
  if (error) throw error;
}
