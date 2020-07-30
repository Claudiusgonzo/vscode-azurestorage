/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzCopyClient, AzCopyExes, AzCopyLocation, FromToOption, IAzCopyClient, ICopyOptions, ILocalLocation, IRemoteSasLocation, TransferStatus } from '@azure-tools/azcopy-node';
import { ContainerClient } from '@azure/storage-blob';
import { ShareClient } from '@azure/storage-file-share';
import { stat } from 'fs-extra';
import { sep } from "path";
import { MessageItem, Progress } from 'vscode';
import { callWithTelemetryAndErrorHandling, IActionContext } from 'vscode-azureextensionui';
import { ext } from '../extensionVariables';
import { TransferProgress } from '../TransferProgress';
import { BlobContainerTreeItem } from '../tree/blob/BlobContainerTreeItem';
import { FileShareTreeItem } from '../tree/fileShare/FileShareTreeItem';
import { createBlobContainerClient } from './blobUtils';
import { cpUtils } from './cpUtils';
import { createShareClient } from './fileUtils';
import { Limits } from './limits';
import { localize } from './localize';
import { openUrl } from './openUrl';

export async function shouldUseAzCopy(context: IActionContext, localPath: string): Promise<boolean> {
    let size = (await stat(localPath)).size;
    context.telemetry.measurements.blockBlobUploadSize = size;

    const useAzCopy: boolean = size > Limits.maxUploadDownloadSizeBytes;
    context.telemetry.properties.azCopyBlockBlobUpload = useAzCopy ? 'true' : 'false';
    return useAzCopy;
}

export function createAzCopyLocalSource(sourcePath: string): ILocalLocation {
    return { type: "Local", path: sourcePath, useWildCard: false };
}

export function createAzCopyLocalDirectorySource(sourceDirectoryPath: string): ILocalLocation {
    // TODO: this doesn't support uploading '.' files/directories (.git & .vscode will need to be excluded)
    // Append an '*' to the path and use wildcard so that all children are uploaded (not including the given folder)
    const path: string = sourceDirectoryPath.endsWith(sep) ? `${sourceDirectoryPath}.*` : `${sourceDirectoryPath}${sep}.*`;
    return { type: "Local", path, useWildCard: true };
}

export function createAzCopyDestination(treeItem: BlobContainerTreeItem | FileShareTreeItem, destinationPath: string): IRemoteSasLocation {
    let resourceUri: string;
    if (treeItem instanceof BlobContainerTreeItem) {
        const containerClient: ContainerClient = createBlobContainerClient(treeItem.root, treeItem.container.name);
        resourceUri = containerClient.url;
    } else {
        const shareClient: ShareClient = createShareClient(treeItem.root, treeItem.shareName);
        resourceUri = shareClient.url;
    }

    const sasToken: string = treeItem.root.generateSasToken();
    const path: string = destinationPath[0] === '/' ? destinationPath : `/${destinationPath}`;
    return { type: "RemoteSas", sasToken, resourceUri, path, useWildCard: false };
}

export async function azCopyBlobTransfer(
    src: ILocalLocation,
    dst: IRemoteSasLocation,
    transferProgress: TransferProgress,
    notificationProgress?: Progress<{
        message?: string | undefined;
        increment?: number | undefined;
    }>,
    throwIfCanceled?: () => void
): Promise<void> {
    await azCopyTransfer(src, dst, transferProgress, 'LocalBlob', notificationProgress, throwIfCanceled);
}

export async function azCopyFileTransfer(
    src: ILocalLocation,
    dst: IRemoteSasLocation,
    transferProgress: TransferProgress,
    notificationProgress?: Progress<{
        message?: string | undefined;
        increment?: number | undefined;
    }>,
    throwIfCanceled?: () => void
): Promise<void> {
    await azCopyTransfer(src, dst, transferProgress, 'LocalFile', notificationProgress, throwIfCanceled);
}

async function azCopyTransfer(
    src: ILocalLocation,
    dst: IRemoteSasLocation,
    transferProgress: TransferProgress,
    fromTo: FromToOption,
    notificationProgress?: Progress<{
        message?: string | undefined;
        increment?: number | undefined;
    }>,
    throwIfCanceled?: () => void,
): Promise<void> {
    if (await validateAzCopyInstalled()) {
        const exes: AzCopyExes = {
            AzCopyExe: ext.azCopyExePath,
            AzCopyExe64: ext.azCopyExePath,
            AzCopyExe32: ext.azCopyExePath
        };
        const copyClient: AzCopyClient = new AzCopyClient({ exes });

        const copyOptions: ICopyOptions = { fromTo, overwriteExisting: "true", recursive: true, followSymLinks: true, excludePath: '.git;.vscode' };
        let jobId = await startAndWaitForCopy(copyClient, src, dst, copyOptions, transferProgress, notificationProgress, throwIfCanceled);
        let finalTransferStatus = (await copyClient.getJobInfo(jobId)).latestStatus;
        if (!finalTransferStatus || finalTransferStatus.JobStatus === 'Failed') {
            throw new Error(localize('azCopyTransferFailed', `AzCopy Transfer Failed${finalTransferStatus?.ErrorMsg ? `: ${finalTransferStatus.ErrorMsg}` : ''}`));
        }
    }
}

async function startAndWaitForCopy(
    copyClient: IAzCopyClient,
    src: AzCopyLocation,
    dst: AzCopyLocation,
    options: ICopyOptions,
    transferProgress: TransferProgress,
    notificationProgress?: Progress<{
        message?: string | undefined;
        increment?: number | undefined;
    }>,
    throwIfCanceled?: () => void
): Promise<string> {
    let jobId: string = await copyClient.copy(src, dst, options);
    let status: TransferStatus | undefined;
    let finishedWork: number;
    while (!status || status.StatusType !== 'EndOfJob') {
        if (!!throwIfCanceled) {
            throwIfCanceled();
        }

        status = (await copyClient.getJobInfo(jobId)).latestStatus;
        // tslint:disable-next-line: strict-boolean-expressions
        finishedWork = status && (src.useWildCard ? status.TransfersCompleted : status.BytesOverWire) || 0;
        transferProgress.reportToOutputWindow(finishedWork);
        if (!!notificationProgress) {
            transferProgress.reportToNotification(finishedWork, notificationProgress);
        }

        // tslint:disable-next-line: no-string-based-set-timeout
        await new Promise((resolve, _reject) => setTimeout(resolve, 1000));
    }

    return jobId;
}

async function azCopyInstalled(): Promise<boolean> {
    try {
        await cpUtils.executeCommand(undefined, undefined, ext.azCopyExePath, '--version');
        return true;
    } catch (error) {
        return false;
    }
}

async function validateAzCopyInstalled(): Promise<boolean> {
    return await callWithTelemetryAndErrorHandling('azureStorage.validateAzCopyInstalled', async (context: IActionContext) => {
        context.errorHandling.suppressDisplay = true;

        if (await azCopyInstalled()) {
            return true;
        } else {
            const message: string = `AzCopy is required for multiple file transfers and transfers >${Limits.maxUploadDownloadSizeMB}MB.`;
            const download: MessageItem = { title: localize('downloadAzCopy', 'Download AzCopy') };
            const input: MessageItem | undefined = await ext.ui.showWarningMessage(message, { modal: true }, download);

            // context.telemetry.properties.dialogResult = input.title;

            if (input === download) {
                await openUrl('https://docs.microsoft.com/en-us/azure/storage/common/storage-use-azcopy-v10');
                // tslint:disable-next-line: no-floating-promises
                ext.ui.showWarningMessage('Be sure to add "azcopy" to your path after downloading.');
            }

            return false;
        }
    }) || false;
}
