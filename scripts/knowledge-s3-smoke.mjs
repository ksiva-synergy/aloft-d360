/** One-off smoke: KNOWLEDGE_BUCKET + IAM user can Put/Get/Delete under knowledge/ */
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const bucket = process.env.KNOWLEDGE_BUCKET?.trim();
const region = process.env.KNOWLEDGE_BUCKET_REGION?.trim() || process.env.AWS_REGION?.trim() || 'ap-south-1';
const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();

if (!bucket) {
  console.error('FAIL: KNOWLEDGE_BUCKET not set');
  process.exit(1);
}
if (!accessKeyId || !secretAccessKey) {
  console.error('FAIL: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY not set (needed for local smoke)');
  process.exit(1);
}

const s3 = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });
const key = 'knowledge/_smoke/permission-check.txt';

try {
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: 'knowledge smoke', ServerSideEncryption: 'AES256' }));
  console.log('OK put:', key);
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  console.log('OK delete:', key);
} catch (e) {
  console.error('FAIL:', e);
  process.exit(1);
}
