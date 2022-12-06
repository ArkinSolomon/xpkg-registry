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
import fs from 'fs';
import path from 'path';

const words = fs
  .readFileSync(path.resolve('.', 'resources', 'profanity_list.txt'), 'utf-8')
  .split(/\n/g);

/**
 * Determine if a text has profanity.
 * 
 * @param {string} text The text to determine.
 * @return {boolean} True if the text is considered vulgar.
 */
export default function isProfane(text: string): boolean {
  const parts = text.split(/[\s._]/);
  
  for (const part of parts) {
    if (words.includes(part.toLowerCase()))
      return true;
  }

  return false;
}