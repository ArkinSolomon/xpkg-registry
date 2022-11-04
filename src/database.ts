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

/**
 * Callback after executing a SQL query.
 *
 * @callback queryCallback
 * @param {Error|null} [err] The error thrown if the query errors, undefined if there was no error.
 * @param {string} [data] The data returned from the callback, undefined if there was an error.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type queryCallback = (err: Error | null, data?: any) => any;

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
 * Execute a query from the connection pool. See https://stackoverflow.com/questions/37102364/how-do-i-create-a-mysql-connection-pool-while-working-with-nodejs-and-express.
 * 
 * @function
 * @param {string} query The query string to execute.
 * @param {queryCallback} callback The callback to run after the connection.
 */
export default function (query: string, callback: queryCallback) {
  pool.getConnection((err, connection) => {
    if (err)
      return callback(err);

    connection.query(query, (err, data) => {
      if (err)
        return callback(err);
      connection.release();
      callback(null, data as object);
    });
    connection.on('error', callback);
  });
}