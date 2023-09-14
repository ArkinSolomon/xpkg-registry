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
import nodemailer from 'nodemailer';
import logger from '../logger.js';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

/**
 * Send an email to someone. 
 * 
 * @param {string} address The email address of the recipient.
 * @param {string} subject The subject line of the email.
 * @param {string} body The body/message of the email.
 */
export default async function (address: string, subject: string, body: string): Promise<void> {
  try {
    await transporter.sendMail({
      from: `"X-Pkg Registry" <${process.env.EMAIL_FROM}>`,
      to: address,
      subject,
      text: body
    });
  } catch (e) {
    logger.error(e, 'There was an error sending an email');
  }
}