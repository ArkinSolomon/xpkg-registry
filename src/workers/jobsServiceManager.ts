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

  _socket: Socket;
  _data: JobData;
  _logger: Logger;

  _authorized = false;
  _done = false;

  /**
   * Create a new connection to the jobs service.
   * 
   * @constructor
   * @param {JobData} jobData The data regarding the job.
   * @param {Logger} logger The logger to log to. Does not create a child logger.
   */
  constructor(jobData: JobData, logger: Logger) {
    this._logger = logger;
    this._data = jobData;
    this._socket = io(`ws://${process.env.JOBS_SERVICE_ADDR}:${process.env.JOBS_SERVICE_PORT}/`, {
      reconnectionAttempts: Infinity,
      reconnectionDelay: 5000
    });

    this._socket.on('handshake', trustKey => {
      this._logger.info('Trust key recieved from jobs service');

      if (!trustKey || typeof trustKey !== 'string') {
        this._socket.disconnect();
        this._logger.error('Jobs service not trusted, invalid data provided');
        process.exit(1);
      }

      const hash = hasha(trustKey, { algorithm: 'sha256' });
      if (hash !== process.env.SERVER_TRUST_HASH) {
        this._socket.disconnect();
        this._logger.error('Jobs service not trusted, invalid server trust');
        process.exit(1);
      }

      this._logger.info('Jobs service trust key valid');      
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

    this._socket.on('disconnect', () => {
      this._authorized = false;

      if (!this._done)
        this._logger.error('Unexpectedly disconnected from jobs service');
      else
        this._logger.info('Disconnected from jobs service');
    });
  }

  /**
   * Wait to be authorized with the jobs service.
   * 
   * @returns {Promise<void>} A promise which returns once the method detects that we have been authorized with the jobs service.
   */
  waitForAuthorization(): Promise<void> {
    return new Promise(resolve => {
      const intervalId = setInterval(() => {
        if (this._authorized) {
          clearInterval(intervalId);
          this._logger.info('Client authorized with jobs service');
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
    await this.waitForAuthorization();
    return new Promise(resolve => {
      this._socket.once('goodbye', () => {
        this._logger.info('Jobs service acknowledged that the job is complete');
        resolve();
      });
      this._socket.emit('done');
    });
  }
}