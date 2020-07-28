/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILocalLocation, IRemoteSasLocation } from 'se-az-copy';
import * as vscode from 'vscode';
import { TelemetryProperties } from "vscode-azureextensionui";
import { ext } from '../extensionVariables';
import { TransferProgress } from '../TransferProgress';
import { BlobContainerTreeItem } from '../tree/blob/BlobContainerTreeItem';
import { FileShareTreeItem } from '../tree/fileShare/FileShareTreeItem';
import { azCopyTransfer, createAzCopyDestination, createAzCopyLocalDirectorySource } from './azCopyUtils';
import { throwIfCanceled } from './errorUtils';
import { localize } from './localize';

export async function uploadFiles(
    destTreeItem: BlobContainerTreeItem | FileShareTreeItem,
    sourceFolder: string,
    destFolder: string,
    properties: TelemetryProperties,
    transferProgress: TransferProgress,
    notificationProgress: vscode.Progress<{
        message?: string | undefined;
        increment?: number | undefined;
    }>,
    cancellationToken: vscode.CancellationToken
): Promise<void> {
    const throwIfCanceledFunction: () => void = () => { throwIfCanceled(cancellationToken, properties, "uploadFiles"); };
    const src: ILocalLocation = createAzCopyLocalDirectorySource(sourceFolder);
    // TODO: support file shares
    let containerName: string = '';
    if (destTreeItem instanceof BlobContainerTreeItem) {
        containerName = destTreeItem.container.name;
    }
    const dst: IRemoteSasLocation = createAzCopyDestination(destTreeItem.root, containerName, destFolder);
    await azCopyTransfer(src, dst, transferProgress, notificationProgress, throwIfCanceledFunction);

    ext.outputChannel.appendLog(localize('finishedUpload', 'Uploaded to "{0}".', destTreeItem.label));
}
