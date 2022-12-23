/*
 * Copyright (c) 2022. X-Pkg Registry Contributors.
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
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Callback after executing a SQL query.
 *
 * @callback queryCallback
 * @param {Error|null} [err] The error thrown if the query errors, undefined if there was no error.
 * @param {*[]} [data] The data returned from the callback, undefined if there was an error.
 */
type queryCallback = (err: Error | null, data: any[]) => void;

import mysql from 'mysql2';

const pool = mysql.createPool({
  connectionLimit: 10,
  host: '127.0.0.1',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: 'xpkg_packages',
  multipleStatements: false
});

/**
 * Execute a query from the connection pool using promises.
 * 
 * @function
 * @param {string} query The query string to execute.
 * @return {Promise<unknown>} A promise which resolves after the query is executed, containing the data from the query.
 */
function query(queryString: string): Promise<any[]>;

/**
 * Execute a query from the connection pool. See https://stackoverflow.com/questions/37102364/how-do-i-create-a-mysql-connection-pool-while-working-with-nodejs-and-express.
 * 
 * @function
 * @param {string} query The query string to execute.
 * @param {queryCallback} callback The callback to run after the connection.
 */
function query(queryString: string, callback: queryCallback): void;
function query(queryString: string, callback?: queryCallback): Promise<any[]> | void {

  // Wrap the function in a promise if no callback is provided
  if (!callback) {
    return new Promise((resolve, reject) => {
      query(queryString, (err, res) => {
        if (err)
          return reject(err);

        resolve(res as any[]);
      });
    });
  }

  pool.getConnection((err, connection) => {
    if (err)
      return callback(err, null as any);

    connection.query(queryString, (err, data) => {
      if (err)
        
        return callback(err, null as any);
      connection.release();

      callback(null, data as any[]);
    });
    connection.on('error', callback);
  });
}

export default query;