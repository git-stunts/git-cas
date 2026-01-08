# @git-stunts/cas

A Git-native Content Addressable Store (CAS) with chunking and encryption.

## Features

- **Automatic Deduplication**: Leveraging Git's internal hashing.
- **AES-256-GCM Encryption**: Securely store binary assets in a Git repository.
- **Manifest-Based**: Tracks chunks and metadata in a simple JSON structure.
- **Tree Generation**: Creates standard Git Trees from file manifests.

## Usage

```javascript
import GitPlumbing from '@git-stunts/plumbing';
import ContentAddressableStore from '@git-stunts/cas';

const git = new GitPlumbing({ cwd: './assets-repo' });
const cas = new ContentAddressableStore({ plumbing: git });

// Store a file
const manifest = await cas.storeFile({
  filePath: './image.png',
  slug: 'my-image',
  encryptionKey: myKeyBuffer // Optional
});

// Create a Git Tree for this asset
const treeOid = cas.createTree({ manifest });

// Now you can point a Git ref to a commit with this tree
```
