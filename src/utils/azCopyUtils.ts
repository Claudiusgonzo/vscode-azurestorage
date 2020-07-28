/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContainerClient } from '@azure/storage-blob';
import { sep } from "path";
import { AzCopyClient, AzCopyLocation, IAzCopyClient, ICopyOptions, ILocalLocation, IRemoteSasLocation, TransferStatus } from 'se-az-copy';
import { setAzCopyExes } from 'se-az-copy/dist/src/AzCopyExe';
import { MessageItem, Progress } from 'vscode';
import { callWithTelemetryAndErrorHandling, IActionContext } from 'vscode-azureextensionui';
import { ext } from '../extensionVariables';
import { TransferProgress } from '../TransferProgress';
import { IStorageRoot } from '../tree/IStorageRoot';
import { createBlobContainerClient } from './blobUtils';
import { cpUtils } from './cpUtils';
import { Limits } from './limits';
import { localize } from './localize';
import { openUrl } from './openUrl';

export function createAzCopyLocalSource(sourcePath: string): ILocalLocation {
    return { type: "Local", path: sourcePath, useWildCard: false };
}

export function createAzCopyLocalDirectorySource(sourceDirectoryPath: string): ILocalLocation {
    // TODO: this doesn't support uploading '.' files/directories (.git & .vscode will need to be excluded)
    // Append an '*' to the path and use wildcard so that all children are uploaded (not including the given folder)
    const path: string = sourceDirectoryPath.endsWith(sep) ? `${sourceDirectoryPath}*` : `${sourceDirectoryPath}${sep}*`;
    return { type: "Local", path, useWildCard: true };
}

export function createAzCopyDestination(root: IStorageRoot, containerName: string, destinationPath: string): IRemoteSasLocation {
    const sasToken: string = root.generateSasToken();
    const containerClient: ContainerClient = createBlobContainerClient(root, containerName);
    const path: string = destinationPath[0] === '/' ? destinationPath : `/${destinationPath}`;
    return { type: "RemoteSas", sasToken, resourceUri: containerClient.url, path, useWildCard: false };
}

export async function azCopyTransfer(
    src: ILocalLocation,
    dst: IRemoteSasLocation,
    transferProgress: TransferProgress,
    notificationProgress?: Progress<{
        message?: string | undefined;
        increment?: number | undefined;
    }>,
    throwIfCanceled?: () => void
): Promise<void> {
    if (await validateAzCopyInstalled()) {
        // Call this at least once before creating an AzCopy client.
        // Once you call it you don't have to call it again
        setAzCopyExes({
            AzCopyExe: ext.azCopyExePath,
            AzCopyExe64: ext.azCopyExePath,
            AzCopyExe32: ext.azCopyExePath
        });

        const copyClient: AzCopyClient = new AzCopyClient({});
        const copyOptions: ICopyOptions = { fromTo: 'LocalBlob', overwriteExisting: "true", recursive: true, followSymLinks: true };
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
