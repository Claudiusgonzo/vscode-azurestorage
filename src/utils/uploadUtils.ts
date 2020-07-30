/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILocalLocation, IRemoteSasLocation } from '@azure-tools/azcopy-node';
import * as vscode from 'vscode';
import { TelemetryProperties } from "vscode-azureextensionui";
import { ext } from '../extensionVariables';
import { TransferProgress } from '../TransferProgress';
import { BlobContainerTreeItem } from '../tree/blob/BlobContainerTreeItem';
import { FileShareTreeItem } from '../tree/fileShare/FileShareTreeItem';
import { azCopyBlobTransfer, azCopyFileTransfer, createAzCopyDestination, createAzCopyLocalDirectorySource } from './azCopyUtils';
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
    const dst: IRemoteSasLocation = createAzCopyDestination(destTreeItem, destFolder);
    if (destTreeItem instanceof BlobContainerTreeItem) {
        await azCopyBlobTransfer(src, dst, transferProgress, notificationProgress, throwIfCanceledFunction);
    } else {
        await azCopyFileTransfer(src, dst, transferProgress, notificationProgress, throwIfCanceledFunction);
    }

    ext.outputChannel.appendLog(localize('finishedUpload', 'Uploaded to "{0}".', destTreeItem.label));
}
