/**
 * File extensions Cloudinary stores under the `image` resource type.
 *
 * The list follows the formats Cloudinary accepts for image upload and transformation; anything else that is not a
 * video is uploaded as `raw`.
 *
 * @see https://cloudinary.com/documentation/image_transformations#supported_image_formats
 */
export const IMAGE_EXTENSIONS: string[] = [
	'.ai',
	'.avif',
	'.png',
	'.webp',
	'.bmp',
	'.bw',
	'.dfvu',
	'.dng',
	'.ps',
	'.ept',
	'.eps',
	'.eps3',
	'.fbx',
	'.flif',
	'.gif',
	'.glb',
	'.gltf',
	'.heif',
	'.heic',
	'.ico',
	'.indd',
	'.jpg',
	'.jpe',
	'.jpeg',
	'.jp2',
	'.wdp',
	'.jxr',
	'.hdp',
	'.obj',
	'.pdf',
	'.ply',
	'.png',
	'.psd',
	'.arw',
	'.cr2',
	'.svg',
	'.tga',
	'.tif',
	'.tiff',
	'.u3ma',
	'.usdz',
	'.webp',
];

/**
 * File extensions Cloudinary stores under the `video` resource type.
 *
 * @see https://cloudinary.com/documentation/video_manipulation_and_delivery#supported_video_formats
 */
export const VIDEO_EXTENSIONS: string[] = [
	'.3g2',
	'.3gp',
	'.avi',
	'.flv',
	'.m3u8',
	'.ts',
	'.m2ts',
	'.mts',
	'.mov',
	'.mkv',
	'.mp4',
	'.mpeg',
	'.mpd',
	'.mxf',
	'.ogv',
	'.webm',
	'.wmv',
];

/**
 * Smallest chunk size Cloudinary accepts for a chunked upload.
 *
 * Every chunk but the last must be at least this large, otherwise the upload API rejects the request.
 *
 * @defaultValue 5 MiB.
 */
export const MINIMUM_CHUNK_SIZE = 5_242_880;
