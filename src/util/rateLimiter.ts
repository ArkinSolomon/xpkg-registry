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
import { Request, Response, NextFunction } from 'express';
import '../database/atlasConnect.js';
import mongoose from 'mongoose';
import { RateLimiterMongo, RateLimiterRes } from 'rate-limiter-flexible';
import Author from '../author.js';

const rateLimitDB = mongoose.connection.useDb('rate-limits');

/**
 * Create a rate-limiting middleware for express, which consumes one point per request. First try to identify users by author id, then try to identify them by ip address. If the user can not be identified by ip address or author id, status code 409 is sent.
 * 
 * @param {string} name The unique name of the rate limiter.
 * @param {number} points The total amount of points that can be consumed.
 * @param {number} duration The duration (in seconds) before the points are reset to zero (in seconds).
 * @param {number} [blockDuration=2] The duration (in seconds) to wait before resetting points if all points are consumed. Defaults to 2 seconds.
 * @returns {Function} A function that returns a middleware to rate limit.
 */
export default function rateLimiter(name: string, points: number, duration: number, blockDuration = 3) {
  return function (req: Request, res: Response, next: NextFunction) {
    const rateLimiter = new RateLimiterMongo({
      storeClient: rateLimitDB,
      points,
      duration,
      blockDuration,
      inMemoryBlockDuration: blockDuration,
      inMemoryBlockOnConsumed: points,
      keyPrefix: 'rate-limit-' + name
    });

    const ip = req.ip || req.socket.remoteAddress;
    let key = ip;
    if (req.user)
      key = (req.user as Author).id;
    
    if (!key)
      return res.sendStatus(409);
    
    rateLimiter.consume(key, 1)
      .then(rateLimiterRes => {
        setHeaders(points, res, rateLimiterRes);
        next();
      })
      .catch(rateLimiterRes => {
        setHeaders(points, res, rateLimiterRes);
        return res.sendStatus(429);
      });
  };
}

/**
 * Set headers after a rate limit consumption.
 * 
 * @param {number} points The total points that can be consumed.
 * @param {Response} res The remaining points that can be consumed.
 * @param {RateLimiterRes} rateLimiterRes The result of the rate limit consumption.
 */
function setHeaders(points: number, res: Response, rateLimiterRes: RateLimiterRes) {
  res.setHeader('Retry-After', rateLimiterRes.msBeforeNext / 1000);
  res.setHeader('X-RateLimit-Limit', points);
  res.setHeader('X-RateLimit-Remaining', rateLimiterRes.remainingPoints);
  res.setHeader('X-RateLimit-Reset', new Date(Date.now() + rateLimiterRes.msBeforeNext).toISOString());
}