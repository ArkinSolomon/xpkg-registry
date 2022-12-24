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

import AuthorDatabase from './authorDatabase';
import MysqlDB from './mysqlDB';

/**
 * Author database implemented in MySQL.
 */
class MysqlAuthorDB extends MysqlDB implements AuthorDatabase {

  /**
   * Create a new database instance with a pool of connections.
   * 
   * @param {number} poolCount The number of connections in a connection pool.
   */
  constructor(poolCount: number) {
    super(poolCount);
  }

  
}