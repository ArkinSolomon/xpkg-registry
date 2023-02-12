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

// Re-export the databases we want to use, some are commented because connections can cause errors on import

// JSON
export { default as authorDatabase } from './json/jsonAuthorDB.js';
export { default as packageDatabase } from './json/jsonPackageDB.js';

// MySQL
// export { default as authorDatabase } from './mysql/mysqlAuthorDB.js';
// export { default as packageDatabase } from './mysql/mysqlPackageDB.js';