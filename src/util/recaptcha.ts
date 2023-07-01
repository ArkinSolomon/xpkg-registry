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

import axios from 'axios';
import logger from '../logger.js';

if (process.env.RECAPTCHA_DISABLE)
  logger.warn('reCAPTCHA disabled');

/**
 * Verify a recaptcha token and, based on the action, determine if the request should be allowed.
 * 
 * @param {string} token The token to verify.
 * @param {string} ip The ip address to report to reCAPTCHA.
 * @returns {Promise<boolean>} A promise which resolves to true if the action should be allowed, or false if the action should not be allowed, or if there is an error.
 */
export default async function verifyRecaptcha(token: string, ip: string): Promise<boolean> {
  if (process.env.RECAPTCHA_DISABLE)
    return true;
  try {
    const params = new URLSearchParams({
      secret: process.env.RECAPTCHA_SECRET as string,
      response: token,
      remoteip: ip
    });

    const res = await axios.post('https://www.google.com/recaptcha/api/siteverify', params);

    const response = res.data as {
      success: boolean;
    };

    return response.success;
  } catch (e) {
    logger.error(e, 'Error with reCAPTCHA verification');
    return false;
  }
}