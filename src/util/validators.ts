/*
 * Copyright (c) 2022-2023. Arkin Solomon.
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
export function isProfane(text: string): boolean {
  const parts = text.split(/[\s._]/);
  
  for (const part of parts) {
    if (words.includes(part.toLowerCase()))
      return true;
  }

  return false;
}

/**
 * Check if a password is valid.
 * 
 * @param {string} password The password to validate.
 * @returns {boolean} True if the password is valid.
 */
export function validatePassword(password: string): boolean {
  return (password && typeof password === 'string' && password.length >= 8 && password.length <= 64 && password.toLowerCase() !== 'password') as boolean;
}

/**
 * Check if an email is valid.
 * 
 * @param {string} email The email to validate.
 * @returns {boolean} True if the email is valid.
 */
export function validateEmail(email: string): boolean {
  return /^\S+@\S+\.\S+$/.test(
    email
      .toLowerCase()
      .trim()
  ) && (email && typeof email === 'string' && email.length >= 4 && email.length <= 64) as boolean;
}

/**
 * Check if a name is valid.
 * 
 * @param {string} name The name to validate.
 * @returns {boolean} True if the name is valid.
 */
export function validateName(name: string): boolean {
  return (name && typeof name === 'string' && name.length > 3 && name.length <= 32 && !isProfane(name)) as boolean;
}