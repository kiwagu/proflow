import type { WorkbenchTranslator } from '@workspace/i18n-catalogs/workbench';

/**
 * Labels for the whole files surface (explorer, rows, pane, viewer). The
 * package is i18n-free by convention — the app resolves its catalog and
 * passes the strings down; the defaults exist so tests and prototypes
 * render something readable. `buildFileExplorerLabels` is the real wiring
 * seam: it reads the literal `workbench.files.*` catalog keys through a
 * `WorkbenchTranslator`, so an app only has to load the catalog and call it.
 */
export type FileExplorerLabels = {
  newDocument: string;
  newFolder: string;
  uploadFiles: string;
  importing: (count: number) => string;
  dropToImport: string;
  empty: string;
  newFolderName: string;
  sectionFiles: string;
  sectionDocuments: string;
  row: {
    fileName: string;
    fileActions: string;
    starred: string;
    rowUnpacked: string;
    rowPacked: string;
    untitled: string;
    rename: string;
    star: string;
    unstar: string;
    unpack: string;
    actionUnpacked: string;
    discardUnpacked: string;
    moveTo: string;
    delete: string;
  };
  pane: {
    select: string;
    opening: string;
    emptyFolder: string;
  };
  viewer: {
    download: string;
    downloadNamed: (name: string) => string;
    loading: string;
    notOnDevice: string;
    noPreview: string;
  };
  errors: {
    unpack: (reason: string) => string;
    discardUnpacked: (reason: string) => string;
    createFolder: (reason: string) => string;
    import: (name: string, reason: string) => string;
  };
};

export const defaultFileExplorerLabels: FileExplorerLabels = {
  newDocument: 'New document',
  newFolder: 'New folder',
  uploadFiles: 'Upload files',
  importing: (count) => `${count} importing`,
  dropToImport: 'Drop to import',
  empty: 'Drop files here, or use the buttons above.',
  newFolderName: 'New folder',
  sectionFiles: 'Files',
  sectionDocuments: 'Documents',
  row: {
    fileName: 'File name',
    fileActions: 'File actions',
    starred: 'Starred',
    rowUnpacked: 'Unpacked',
    rowPacked: 'Not unpacked yet',
    untitled: 'Untitled',
    rename: 'Rename',
    star: 'Star',
    unstar: 'Unstar',
    unpack: 'Unpack',
    actionUnpacked: 'Unpacked',
    discardUnpacked: 'Delete unpacked files',
    moveTo: 'Move to',
    delete: 'Delete',
  },
  pane: {
    select: 'Select a file.',
    opening: 'Opening…',
    emptyFolder: 'Empty folder.',
  },
  viewer: {
    download: 'Download',
    downloadNamed: (name) => `Download ${name}`,
    loading: 'Loading…',
    notOnDevice: 'These bytes are not on this device.',
    noPreview: 'No preview for this file type.',
  },
  errors: {
    unpack: (reason) => `Could not unpack: ${reason}`,
    discardUnpacked: (reason) =>
      `Could not delete the unpacked files: ${reason}`,
    createFolder: (reason) => `Could not create the folder: ${reason}`,
    import: (name, reason) => `Could not import ${name}: ${reason}`,
  },
};

/**
 * Builds the files surface's labels from the workbench catalog: literal
 * `workbench.files.*` keys, looked up through the app's loaded translator.
 */
export function buildFileExplorerLabels(
  t: WorkbenchTranslator
): FileExplorerLabels {
  return {
    newDocument: t('workbench.files.newDocument'),
    newFolder: t('workbench.files.newFolder'),
    uploadFiles: t('workbench.files.uploadFiles'),
    importing: (count) => t('workbench.files.importing', { count }),
    dropToImport: t('workbench.files.dropToImport'),
    empty: t('workbench.files.empty'),
    newFolderName: t('workbench.files.newFolderName'),
    sectionFiles: t('workbench.files.section.files'),
    sectionDocuments: t('workbench.files.section.documents'),
    row: {
      fileName: t('workbench.files.row.name'),
      fileActions: t('workbench.files.row.actions'),
      starred: t('workbench.files.row.starred'),
      rowUnpacked: t('workbench.files.row.unpacked'),
      rowPacked: t('workbench.files.row.packed'),
      untitled: t('workbench.files.untitled'),
      rename: t('workbench.files.action.rename'),
      star: t('workbench.files.action.star'),
      unstar: t('workbench.files.action.unstar'),
      unpack: t('workbench.files.action.unpack'),
      actionUnpacked: t('workbench.files.action.unpacked'),
      discardUnpacked: t('workbench.files.action.discardUnpacked'),
      moveTo: t('workbench.files.action.moveTo'),
      delete: t('workbench.files.action.delete'),
    },
    pane: {
      select: t('workbench.files.pane.select'),
      opening: t('workbench.files.pane.opening'),
      emptyFolder: t('workbench.files.pane.emptyFolder'),
    },
    viewer: {
      download: t('workbench.files.viewer.download'),
      downloadNamed: (name) =>
        t('workbench.files.viewer.downloadNamed', { name }),
      loading: t('workbench.files.viewer.loading'),
      notOnDevice: t('workbench.files.viewer.notOnDevice'),
      noPreview: t('workbench.files.viewer.noPreview'),
    },
    errors: {
      unpack: (reason) => t('workbench.files.error.unpack', { reason }),
      discardUnpacked: (reason) =>
        t('workbench.files.error.discardUnpacked', { reason }),
      createFolder: (reason) =>
        t('workbench.files.error.createFolder', { reason }),
      import: (name, reason) =>
        t('workbench.files.error.import', { name, reason }),
    },
  };
}
