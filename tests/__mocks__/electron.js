import os from 'os';
import path from 'path';

const tempDir = path.join(os.tmpdir(), 'ollama-client-test');

export const app = {
    getPath: (pathType) => {
        if (pathType === 'userData') {
            return tempDir;
        }
        return os.tmpdir();
    }
};
