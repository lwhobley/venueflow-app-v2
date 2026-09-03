import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomBytes } from 'crypto';

@Injectable()
export class S3ImageService {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.s3 = new S3Client({
      region: config.get<string>('AWS_REGION', 'us-east-1'),
      credentials: {
        accessKeyId: config.getOrThrow<string>('AWS_ACCESS_KEY_ID'),
        secretAccessKey: config.getOrThrow<string>('AWS_SECRET_ACCESS_KEY'),
      },
    });
    this.bucket = config.getOrThrow<string>('AWS_S3_BUCKET');
  }

  /** Upload a buffer and return the permanent object key. */
  async upload(buffer: Buffer, mimeType: string, venueId: string): Promise<string> {
    const key = `chat/${venueId}/${randomBytes(16).toString('hex')}`;
    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      ServerSideEncryption: 'AES256',
    }));
    return key;
  }

  /**
   * Generate a pre-signed GET URL. Short-lived by default: this URL requires
   * no auth at all once issued, so keep the window tight — it's only meant to
   * be followed immediately via the 302 redirect from the media-access route.
   */
  async getPresignedUrl(key: string, expiresInSeconds = 300): Promise<string> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: 'inline',
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  /** Hard-delete an object (e.g. on chat message delete). */
  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
