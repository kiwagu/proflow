'use client';

import * as React from 'react';
import { UploadIcon, XIcon, Loader2Icon } from 'lucide-react';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@workspace/ui/components/avatar';
import { Button } from '@workspace/ui/components/button';
import { cn } from '@workspace/ui/lib/utils';

export interface ImageUploadProps {
  value?: string;
  onChange?: (url: string) => void;
  onUpload: (file: File) => Promise<string>;
  onError?: (error: Error) => void;
  className?: string;
  disabled?: boolean;
}

export function ImageUpload({
  value,
  onChange,
  onUpload,
  onError,
  className,
  disabled = false,
}: ImageUploadProps) {
  const [isDragging, setIsDragging] = React.useState(false);
  const [isUploading, setIsUploading] = React.useState(false);
  const [previewUrl, setPreviewUrl] = React.useState<string | undefined>(value);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setPreviewUrl(value);
  }, [value]);

  const handleFile = async (file: File) => {
    if (disabled || isUploading) return;
    if (!file.type.startsWith('image/')) {
      onError?.(new Error('File must be an image.'));
      return;
    }

    try {
      setIsUploading(true);
      // Create a local preview immediately
      const objectUrl = URL.createObjectURL(file);
      setPreviewUrl(objectUrl);

      // Upload via the provided callback
      const uploadedUrl = await onUpload(file);
      setPreviewUrl(uploadedUrl);
      onChange?.(uploadedUrl);
    } catch (error) {
      // Revert preview on error
      setPreviewUrl(value);
      onError?.(error instanceof Error ? error : new Error('Upload failed'));
    } finally {
      setIsUploading(false);
    }
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleFile(file);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void handleFile(file);
    }
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled || isUploading) return;
    setPreviewUrl(undefined);
    onChange?.('');
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  return (
    <div
      className={cn(
        'relative inline-flex flex-col items-center gap-4',
        className
      )}
    >
      <div
        className={cn(
          'relative flex h-32 w-32 cursor-pointer items-center justify-center rounded-full border-2 border-dashed transition-colors',
          isDragging
            ? 'border-primary bg-primary/10'
            : 'border-muted-foreground/25 hover:bg-accent/50',
          disabled && 'cursor-not-allowed opacity-50',
          isUploading && 'cursor-wait'
        )}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => !disabled && !isUploading && inputRef.current?.click()}
        data-testid="image-upload-dropzone"
      >
        <Avatar className="h-full w-full">
          <AvatarImage src={previewUrl} alt="Avatar preview" />
          <AvatarFallback className="bg-transparent">
            {isUploading ? (
              <Loader2Icon className="text-muted-foreground h-8 w-8 animate-spin" />
            ) : (
              <UploadIcon className="text-muted-foreground h-8 w-8" />
            )}
          </AvatarFallback>
        </Avatar>

        {previewUrl && !disabled && !isUploading && (
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="absolute top-0 -right-2 h-8 w-8 rounded-full"
            onClick={handleRemove}
            data-testid="image-upload-remove"
          >
            <XIcon className="h-4 w-4" />
            <span className="sr-only">Remove image</span>
          </Button>
        )}

        <input
          type="file"
          ref={inputRef}
          className="hidden"
          accept="image/*"
          onChange={handleInputChange}
          disabled={disabled || isUploading}
          data-testid="image-upload-input"
        />
      </div>
      <div className="text-muted-foreground text-center text-sm">
        <p>Drag & drop or click to upload</p>
      </div>
    </div>
  );
}
