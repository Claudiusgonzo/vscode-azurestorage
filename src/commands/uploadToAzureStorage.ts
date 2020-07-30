/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fse from 'fs-extra';
import { basename, dirname } from 'path';
import * as vscode from 'vscode';
import { IActionContext } from 'vscode-azureextensionui';
import { ext } from '../extensionVariables';
import { TransferProgress } from '../TransferProgress';
import { BlobContainerTreeItem } from '../tree/blob/BlobContainerTreeItem';
import { FileShareTreeItem } from '../tree/fileShare/FileShareTreeItem';
import { shouldUseAzCopy } from '../utils/azCopyUtils';
import { doesBlobExist, getBlobPath } from '../utils/blobUtils';
import { doesFileExist, getFileName } from '../utils/fileUtils';
import { getNumFilesInDirectory } from '../utils/fs';
import { localize } from '../utils/localize';
import { uploadFiles } from '../utils/uploadUtils';
import { warnFileAlreadyExists } from '../utils/validateNames';
import { selectWorkspaceItem } from '../utils/workspaceUtils';

export async function uploadToAzureStorage(actionContext: IActionContext, target?: vscode.Uri): Promise<void> {
    let resourcePath: string;
    if (target) {
        if (target.scheme === 'azurestorage') {
            throw new Error(localize('cannotUploadToAzureFromAzureResource', 'Cannot upload to Azure from an Azure resource.'));
        }

        resourcePath = target.fsPath;
    } else {
        resourcePath = await selectWorkspaceItem(
            ext.ui,
            localize('selectResourceToUpload', 'Select resource to upload'),
            {
                canSelectFiles: true,
                canSelectFolders: true,
                canSelectMany: false,
                defaultUri: vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0 ? vscode.workspace.workspaceFolders[0].uri : undefined,
                openLabel: localize('select', 'Select')
            });
    }

    let treeItem: BlobContainerTreeItem | FileShareTreeItem = await ext.tree.showTreeItemPicker([BlobContainerTreeItem.contextValue, FileShareTreeItem.contextValue], actionContext);
    let destinationName: string;
    let destinationPath: string = basename(resourcePath);
    if (treeItem instanceof BlobContainerTreeItem) {
        destinationName = treeItem.container.name;
        destinationPath = await getBlobPath(treeItem, destinationPath);
    } else {
        destinationName = treeItem.shareName;
        destinationPath = await getFileName(treeItem, dirname(resourcePath), treeItem.shareName, destinationPath);
    }

    await vscode.window.withProgress({ cancellable: true, location: vscode.ProgressLocation.Notification, title: `Uploading to ${destinationName} from ${resourcePath}` }, async (notificationProgress, cancellationToken) => {
        if ((await fse.stat(resourcePath)).isDirectory()) {
            const uploadSize: number = await getNumFilesInDirectory(resourcePath);
            const transferProgress: TransferProgress = new TransferProgress(uploadSize);
            await uploadFiles(treeItem, resourcePath, destinationPath, actionContext.telemetry.properties, transferProgress, notificationProgress, cancellationToken);
        } else {
            if (treeItem instanceof BlobContainerTreeItem ? await doesBlobExist(treeItem, destinationPath) : await doesFileExist(basename(destinationPath), treeItem, dirname(destinationPath), treeItem.shareName)) {
                await warnFileAlreadyExists(destinationPath);
            }

            await treeItem.uploadLocalFile(resourcePath, destinationPath, await shouldUseAzCopy(actionContext, resourcePath));
        }
    });
}
