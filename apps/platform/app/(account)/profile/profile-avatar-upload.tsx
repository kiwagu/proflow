'use client';

import * as React from 'react';
import { ImageUpload } from '@workspace/ui/components/image-upload';
import { createClient } from '@/lib/supabase/client';

export interface ProfileAvatarUploadProps {
  value?: string;
  onChange?: (url: string) => void;
  userId: string;
}

export function ProfileAvatarUpload({
  value,
  onChange,
  userId,
}: ProfileAvatarUploadProps) {
  const handleUpload = async (file: File) => {
    const supabase = createClient();

    // We upload to 'avatars/<userId>/<filename>'
    // To avoid cache issues, we append a timestamp to the filename
    const fileExt = file.name.split('.').pop();
    const fileName = `${userId}-${Date.now()}.${fileExt}`;
    const filePath = `avatars/${userId}/${fileName}`;

    const { data, error } = await supabase.storage
      .from('media')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true,
      });

    if (error) {
      throw error;
    }

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('media')
      .getPublicUrl(filePath);

    return publicUrlData.publicUrl;
  };

  return (
    <ImageUpload value={value} onChange={onChange} onUpload={handleUpload} />
  );
}
