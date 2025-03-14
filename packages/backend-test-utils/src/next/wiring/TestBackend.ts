/*
 * Copyright 2022 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  Backend,
  createSpecializedBackend,
  lifecycleFactory,
  loggerFactory,
  rootLoggerFactory,
} from '@backstage/backend-app-api';
import {
  ServiceFactory,
  ServiceRef,
  createServiceFactory,
  BackendFeature,
  ExtensionPoint,
} from '@backstage/backend-plugin-api';

/** @alpha */
export interface TestBackendOptions<
  TServices extends any[],
  TExtensionPoints extends any[],
> {
  services?: readonly [
    ...{
      [index in keyof TServices]:
        | ServiceFactory<TServices[index]>
        | (() => ServiceFactory<TServices[index]>)
        | [ServiceRef<TServices[index]>, Partial<TServices[index]>];
    },
  ];
  extensionPoints?: readonly [
    ...{
      [index in keyof TExtensionPoints]: [
        ExtensionPoint<TExtensionPoints[index]>,
        Partial<TExtensionPoints[index]>,
      ];
    },
  ];
  features?: BackendFeature[];
}

const defaultServiceFactories = [
  rootLoggerFactory(),
  loggerFactory(),
  lifecycleFactory(),
];

const backendInstancesToCleanUp = new Array<Backend>();

/** @alpha */
export async function startTestBackend<
  TServices extends any[],
  TExtensionPoints extends any[],
>(options: TestBackendOptions<TServices, TExtensionPoints>): Promise<Backend> {
  const {
    services = [],
    extensionPoints = [],
    features = [],
    ...otherOptions
  } = options;

  const factories = services.map(serviceDef => {
    if (Array.isArray(serviceDef)) {
      // if type is ExtensionPoint?
      // do something differently?
      const [ref, impl] = serviceDef;
      if (ref.scope === 'plugin') {
        return createServiceFactory({
          service: ref,
          deps: {},
          factory: async () => async () => impl,
        })();
      }
      return createServiceFactory({
        service: ref,
        deps: {},
        factory: async () => impl,
      })();
    }
    return serviceDef as ServiceFactory;
  });

  for (const factory of defaultServiceFactories) {
    if (!factories.some(f => f.service === factory.service)) {
      factories.push(factory);
    }
  }

  const backend = createSpecializedBackend({
    ...otherOptions,
    services: factories,
  });

  backendInstancesToCleanUp.push(backend);

  backend.add({
    id: `---test-extension-point-registrar`,
    register(reg) {
      for (const [ref, impl] of extensionPoints) {
        reg.registerExtensionPoint(ref, impl);
      }

      reg.registerInit({ deps: {}, async init() {} });
    },
  });

  for (const feature of features) {
    backend.add(feature);
  }

  await backend.start();

  return backend;
}

let registered = false;
function registerTestHooks() {
  if (typeof afterAll !== 'function') {
    return;
  }
  if (registered) {
    return;
  }
  registered = true;

  afterAll(async () => {
    await Promise.all(
      backendInstancesToCleanUp.map(async backend => {
        try {
          await backend.stop();
        } catch (error) {
          console.error(`Failed to stop backend after tests, ${error}`);
        }
      }),
    );
    backendInstancesToCleanUp.length = 0;
  });
}

registerTestHooks();
