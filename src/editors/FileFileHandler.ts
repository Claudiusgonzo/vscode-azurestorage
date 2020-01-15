/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as azureStorageShare from '@azure/storage-file-share';
import { FileTreeItem } from "../tree/fileShare/FileTreeItem";
import { getExistingCreateOptions } from '../utils/fileUtils';
import { createFileClient } from '../utils/fileUtils';
import { IRemoteFileHandler } from './IRemoteFileHandler';

export class FileFileHandler implements IRemoteFileHandler<FileTreeItem> {
    async getSaveConfirmationText(treeItem: FileTreeItem): Promise<string> {
        return `Saving '${treeItem.fileName}' will update the file "${treeItem.fileName}" in File Share "${treeItem.shareName}"`;
    }

    async getFilename(treeItem: FileTreeItem): Promise<string> {
        return treeItem.fileName;
    }

    async downloadFile(treeItem: FileTreeItem, filePath: string): Promise<void> {
        const fileClient = createFileClient(treeItem.root, treeItem.shareName, treeItem.directoryPath, treeItem.fileName);
        await fileClient.downloadToFile(filePath);
    }

    async uploadFile(treeItem: FileTreeItem, filePath: string): Promise<void> {
        const options: azureStorageShare.FileCreateOptions = await getExistingCreateOptions(treeItem.directoryPath, treeItem.fileName, treeItem.shareName, treeItem.root);
        const fileClient: azureStorageShare.ShareFileClient = createFileClient(treeItem.root, treeItem.shareName, treeItem.directoryPath, treeItem.fileName);
        await fileClient.uploadFile(filePath, options);
    }
}