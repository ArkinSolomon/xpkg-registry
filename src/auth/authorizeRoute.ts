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
import { NextFunction, Request, Response } from 'express';
import AuthToken from './authToken.js';
import logger from '../logger.js';

/**
 * Create a new instance of an authorization middleware. Sets the {@code req.user} property to the author's token, or returns 401 if {@code optional} is set to false.
 * 
 * @param {boolean} [optional=false] True if authorization is optional. Defaults to requiring authorizations.
 * @returns {Function} Express middleware that authorizes users.
 */
export default function (optional = false) {
  return async function (req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.headers.authorization;
      if (typeof token !== 'string')
  
        // Just throw and let exception handling redirect/notify
        throw null;
      
      const authToken = await AuthToken.verify(token);
      const author = await authToken.getAuthor();
  
      if (author.session !== authToken.session)
        throw null;
      
      else if (authToken.tokenSession) {
        if (!author.tokens.find(t => t.tokenSession === authToken.tokenSession))
          throw null;
      }
  
      req.user = authToken;
  
      next();
    } catch (e) {
      if (optional) {
        logger.trace('Optional authorization, will go to next middleware');
        return next();
      }
      logger.info(e, `Unauthorized authorization attempt from ${req.ip}`);
      return res.sendStatus(401);
    }
  };
}