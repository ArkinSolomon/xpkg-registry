/*
 * Copyright (c) 2023. Arkin Solomon.
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * 
 *     http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
 * either express or implied limitations under the License.
 */

// Note that the following types are exactly the same as in the jobs service code

/**
 * The different type of jobs.
 * 
 * @name JobType
 * @enum {string}
 */
export enum JobType {
  Packaging = 'packaging',
  Resource = 'resource'
}

/**
 * Data sent by the worker about it's job.
 * 
 * @typedef {Object} JobData
 * @property {JobType} jobType The type of the job.
 * @property {PackagingInfo|ResourceInfo} info The information about the job.
 */
export type JobData = {
  jobType: JobType;
  info: PackagingInfo | ResourceInfo;
}

/**
 * Information about a packaging job.
 * 
 * @typedef {Object} PackagingInfo
 * @property {string} packageId The id of the package being processed.
 * @property {string} version The version of the package being processed.
 */
export type PackagingInfo = {
  packageId: string;
  version: string;
}

/**
 * Information about a resource job.
 * 
 * @typedef {Object} ResourceInfo
 * @property {string} resourceId The id of the resource being processed.
 */
export type ResourceInfo = {
  resourceId: string;
};

import hasha from 'hasha';
import { Logger } from 'pino';
import { Socket, io } from 'socket.io-client';

/**
 * A class to communicate with the jobs service for a single job.
 */
export default class JobsServiceManager {

  private _socket: Socket;
  private _data: JobData;
  private _logger: Logger;

  private _onAbort: () => void;

  private _authorized = false;
  private _done = false;
  private _aborted = false;

  /**
   * True if the job has been aborted.
   * 
   * @type {boolean}
   */
  get aborted(): boolean {
    return this._aborted;
  }

  /**
   * Create a new connection to the jobs service.
   * 
   * @constructor
   * @param {JobData} jobData The data regarding the job.
   * @param {Logger} logger The logger to log to. Does not create a child logger.
   * @param {() => Promise<void>} onAbort The function which is run when a job is aborted.
   */
  constructor(jobData: JobData, logger: Logger, onAbort: () => Promise<void>) {
    this._onAbort = onAbort;
    this._logger = logger;
    this._data = jobData;
    this._socket = io(`https://${process.env.JOBS_SERVICE_ADDR}/`, {
      reconnectionAttempts: Infinity,
      reconnectionDelay: 5000,
      rejectUnauthorized: true,
      secure: true
    });

    this._socket.on('handshake', trustKey => {
      this._logger.info('Trust key recieved from jobs service');

      if (!trustKey || typeof trustKey !== 'string') {
        this._logger.error('Jobs service not trusted, invalid data provided');
        this._socket.disconnect();
        this._abort();
        return;
      }

      const hash = hasha(trustKey, { algorithm: 'sha256' });
      if (hash !== process.env.SERVER_TRUST_HASH) {
        this._logger.error('Jobs service not trusted, invalid server trust');
        this._socket.disconnect();
        this._abort();
        return;
      }

      this._logger.debug('Jobs service trust key valid');      
      this._socket.emit('handshake', process.env.JOBS_SERVICE_PASSWORD);
    });

    this._socket.on('authorized', () => {
      this._logger.info('Authorized successfully with jobs service');
      this._socket.emit('job_data', jobData);
    });

    this._socket.on('job_data_recieived', () => {
      this._logger.info('Job data received by jobs service');
      this._authorized = true;
    });

    this._socket.on('disconnect', async reason => {
      this._authorized = false;

      if (reason === 'io server disconnect') {
        this._logger.warn(`Forcefully disconnected from jobs service, will abort job (${reason})`);
        await this._abort();
      }
      else if (!this._aborted) {
        if (!this._done)
          this._logger.error(`Unexpectedly disconnected from jobs service (${reason})`);
        else
          this._logger.debug(`Gracefully disconnected from jobs service (${reason})`);
      } else 
        this._logger.info(`Disconnected from jobs service, job aborted (${reason})`);
      
      // Terrible way to do this, but we need the logs to finish (and logger.flush doesn't work :/)
      setTimeout(() => process.exit(), 250);
    });
    
    this._socket.on('abort', () => {
      this._logger.info('Abort request recieved from jobs service');
      this._socket.emit('aborting');
      this._abort();
    });
  }

  /**
   * Abort the job.
   * 
   * @async
   * @returns {Promise<void>} A promise which resolves after all abortion operations complete.
   */
  private async _abort(): Promise<void> {
    this._logger.warn('Aborting job');

    this._done = true;
    this._aborted = true;

    await this._onAbort();

    await this.waitForAuthorization();
    this._socket.emit('done', 'aborted');
    this._socket.disconnect();
  }

  /**
   * Wait to be authorized with the jobs service.
   * 
   * @returns {Promise<void>} A promise which returns once the method detects that we have been authorized with the jobs service.
   */
  waitForAuthorization(): Promise<void> {
    if (!this._authorized)
      this._logger.debug('Waiting for authorization with jobs service');
    return new Promise(resolve => {
      const intervalId = setInterval(() => {
        if (this._authorized) {
          clearInterval(intervalId);
          this._logger.debug('Worker authorized with jobs service');
          resolve();
        }
      }, 500);
    });
  }
  
  /**
   * Tell the server that the job is completed.
   * 
   * @async
   * @returns {Promise<void>} A promise which resolves when the server acknowledges the completion.
   */
  async completed(): Promise<void> {
    if (this._aborted) {
      this._logger.warn('Job is attempting to complete after abortion started, can not complete');
      return;
    }

    await this.waitForAuthorization();
    return new Promise(resolve => {
      this._done = true;
      this._socket.once('goodbye', () => {
        this._logger.info('Jobs service acknowledged that the job is complete');
        resolve();
        this._socket.disconnect();
      });
      this._socket.emit('done', 'normal');
    });
  }
}