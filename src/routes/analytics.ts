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

import { matchedData, param, query, validationResult } from 'express-validator';
import logger from '../logger.js';
import * as validators from '../util/validators.js';
import { Router } from 'express';
import Version from '../util/version.js';
import { dateToUTCHour } from '../util/dateUtil.js';
import AuthToken, { TokenPermission } from '../auth/authToken.js';
import * as packageDatabase from '../database/packageDatabase.js';
import * as analyticsDatabase from '../database/analyticsDatabase.js';
import NoSuchPackageError from '../errors/noSuchPackageError.js';

const route = Router();

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const THIRTY_DAYS_MS = 30 * ONE_DAY_MS;

route.get('/:packageId/:packageVersion',
  validators.asPartialXpkgPackageId(param('packageId')),
  validators.asVersion(param('packageVersion')),
  query('after').trim().notEmpty().isInt({
    min: 1672531200000 // Sun, 01 Jan 2023 00:00:00 GMT
  }).toInt().withMessage('bad_after_date'),
  query('before').trim().notEmpty().isInt({
    min: 1672531260000 // Sun, 01 Jan 2023 00:01:00 GMT
  }).toInt().optional().withMessage('bad_before_date'),
  async (req, res) => {
    const token = req.user as AuthToken | undefined;

    const routeLogger = logger.child({
      ip: req.ip,
      route: '/analytics/:packageId/:packageVersion',
      requestId: req.id
    });

    const result = validationResult(req);
    if (!result.isEmpty()) {
      const message = result.array()[0].msg;
      routeLogger.trace(`Validation failed with message: ${message}`);
      return res
        .status(400)
        .send(message);
    }

    const validatedFields = matchedData(req)as {
      packageVersion: Version;
      packageId: string;
      after?: number;
      before?: number;
    };
    const { packageId, packageVersion } = validatedFields ;

    let after = new Date(validatedFields.after ?? Date.now() - ONE_DAY_MS);
    let before = validatedFields.before ? new Date(validatedFields.before) : new Date();

    after = dateToUTCHour(after);
    before = dateToUTCHour(before);

    if (after > before) {
      routeLogger.trace('After date is after before date (bad_date_combo)');
      return res
        .status(400)
        .send('bad_date_combo');
    }

    const difference = before.valueOf() - after.valueOf();
    if (difference < ONE_HOUR_MS) {
      routeLogger.info({
        difference: `${difference}ms`,
      }, 'Time difference is less than one hour (short_diff)');
      return res
        .status(400)
        .send('short_diff');
    }

    if (before.valueOf() - after.valueOf() > THIRTY_DAYS_MS) {
      routeLogger.info({
        difference: `${difference}ms`,
      }, 'Time difference is greater than 30 day (long_diff)');
      return res
        .status(400)
        .send('long_diff');
    }

    try {
      const versionData = await packageDatabase.getVersionData(packageId, packageVersion);
      const authorHasPackage = token && await packageDatabase.doesAuthorHavePackage(token.authorId, packageId);

      if (!versionData.isPublic && !authorHasPackage) {
        routeLogger.trace('Version is not public, or author does not have package');

        if (!token || !token.hasPermission(TokenPermission.ViewAnalytics)) {
          routeLogger.trace('No token provided, or has insufficient permissions');
          return res.sendStatus(404);
        }
      }

      routeLogger.trace({
        after: after.toUTCString(),
        before: before.toUTCString()
      }, 'Getting analytics...');

      res
        .status(200)
        .json(await analyticsDatabase.getVersionAnalyticsData(packageId, packageVersion, after, before));
    } catch (e) {
      if (e instanceof NoSuchPackageError) {
        routeLogger.trace(e, 'Attempted to get version data for non-existent package');
        return res.sendStatus(404);        
      }

      routeLogger.error(e);
      return res.sendStatus(500);
    }
  });

export default route;