import { t } from 'elysia'

// File entry
export const FileEntry = t.Object({
  name: t.String({ description: 'File or directory name' }),
  type: t.Union([t.Literal('file'), t.Literal('directory')], { description: 'Entry type' }),
  size: t.Number({ description: 'File size in bytes (0 for directories)' }),
  modified: t.String({ description: 'Last modified timestamp' }),
  extension: t.Optional(t.String({ description: 'File extension' })),
  editable: t.Optional(t.Boolean({ description: 'Whether file can be edited' })),
  sensitive: t.Optional(t.Boolean({ description: 'Whether file contains sensitive data' })),
  fileType: t.Optional(
    t.Union([t.Literal('text'), t.Literal('config'), t.Literal('image'), t.Literal('archive'), t.Literal('binary')], {
      description: 'File type category',
    }),
  ),
})

// List directory request
export const ListDirBody = t.Object({
  path: t.Optional(t.String({ description: 'Relative path to list (default: root)' })),
})

// List directory response
export const ListDirResponse = t.Object({
  path: t.String({ description: 'Current directory path' }),
  entries: t.Array(FileEntry),
})

// Read file response
export const ReadFileResponse = t.Object({
  path: t.String({ description: 'File path' }),
  name: t.String({ description: 'Filename' }),
  size: t.Number({ description: 'File size in bytes' }),
  modified: t.String({ description: 'Last modified timestamp' }),
  editable: t.Boolean({ description: 'Whether file can be edited' }),
  sensitive: t.Boolean({ description: 'Whether file contains sensitive data' }),
  fileType: t.Union(
    [t.Literal('text'), t.Literal('config'), t.Literal('image'), t.Literal('archive'), t.Literal('binary')],
    { description: 'File type category' },
  ),
  content: t.Nullable(t.String({ description: 'File content' })),
  encoding: t.Nullable(t.Union([t.Literal('utf8'), t.Literal('base64')], { description: 'Content encoding' })),
  tooLarge: t.Optional(t.Boolean({ description: 'File exceeds size limit' })),
  message: t.Optional(t.String({ description: 'Additional info message' })),
})

// Write file request
export const WriteFileBody = t.Object({
  content: t.String({ description: 'File content to write' }),
})

// Write file response
export const WriteFileResponse = t.Object({
  success: t.Boolean({ description: 'Operation success' }),
  path: t.String({ description: 'File path' }),
  size: t.Number({ description: 'New file size' }),
  sensitive: t.Boolean({ description: 'Whether file contains sensitive data' }),
})

// Mkdir response
export const MkdirResponse = t.Object({
  success: t.Boolean({ description: 'Operation success' }),
  path: t.String({ description: 'Created directory path' }),
})

// Delete response
export const DeleteResponse = t.Object({
  success: t.Boolean({ description: 'Operation success' }),
  path: t.String({ description: 'Deleted path' }),
  type: t.Union([t.Literal('file'), t.Literal('directory')], { description: 'Deleted entry type' }),
})

// Rename request
export const RenameBody = t.Object({
  oldPath: t.String({ description: 'Current path' }),
  newPath: t.String({ description: 'New path' }),
})

// Rename response
export const RenameResponse = t.Object({
  success: t.Boolean({ description: 'Operation success' }),
  oldPath: t.String({ description: 'Original path' }),
  newPath: t.String({ description: 'New path' }),
})

// Upload response
export const UploadResponse = t.Object({
  success: t.Boolean({ description: 'Operation success' }),
  uploaded: t.Array(
    t.Object({
      name: t.String({ description: 'Uploaded filename' }),
      size: t.Number({ description: 'File size in bytes' }),
    }),
  ),
  count: t.Number({ description: 'Number of files uploaded' }),
})
