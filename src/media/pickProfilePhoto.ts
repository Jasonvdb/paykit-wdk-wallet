// Pick a profile photo from the library, square-cropped and shrunk.
//
// Paykit stores avatars as public blobs on the homeserver
// (`uploadProfileAvatar` accepts JPEG/PNG/WebP/GIF). Bitkit resizes to at
// most 400 px at JPEG quality 0.8 before uploading; we do the same, which
// keeps avatars around 30-60 KB.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { arrayBufferToBase64, base64ToArrayBuffer } from '../paykit/bytes';

export type ProfilePhoto = {
  /** For an <Image> preview. */
  previewUri: string;
  bytes: ArrayBuffer;
  contentType: 'image/jpeg';
};

const MAX_EDGE = 400;

/** Resolves undefined if the user cancels. */
export async function pickProfilePhoto(): Promise<ProfilePhoto | undefined> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });
  const asset = picked.canceled ? undefined : picked.assets[0];
  if (!asset) return undefined;

  const context = ImageManipulator.manipulate(asset.uri);
  context.resize({ width: MAX_EDGE, height: MAX_EDGE });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ base64: true, compress: 0.8, format: SaveFormat.JPEG });
  if (!saved.base64) throw new Error('Could not read the photo.');
  return { previewUri: saved.uri, bytes: base64ToArrayBuffer(saved.base64), contentType: 'image/jpeg' };
}

/** A picked photo as a data: URI, to preview it before it is published. */
export function photoDataUri(photo: ProfilePhoto): string {
  return `data:${photo.contentType};base64,${arrayBufferToBase64(photo.bytes)}`;
}
