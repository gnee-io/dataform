import * as protos from "@dataform/protos";
import { fork } from "child_process";
import * as path from "path";
import * as dbadapters from "../dbadapters";
import * as utils from "../utils";
import { CancellablePromise } from "../utils/cancellable_promise";

interface IOptions {
  projectDir?: string;
}

export function run(
  profile: protos.IProfile,
  query: string,
  options?: IOptions
): CancellablePromise<any[]> {
  utils.validateProfile(profile);
  return new CancellablePromise(async (_resolve, _reject, onCancel) => {
    try {
      const compiledQuery = await compile(query, options);
      const results = await dbadapters.create(profile).execute(compiledQuery, onCancel);
      _resolve(results);
    } catch (e) {
      _reject(e);
    }
  });
}

export function evaluate(
  profile: protos.IProfile,
  query: string,
  options?: IOptions
): Promise<void> {
  return compile(query, options).then(compiledQuery =>
    dbadapters.create(profile).evaluate(compiledQuery)
  );
}

export function compile(query: string, options?: IOptions): Promise<string> {
  // If there is no project directory, no need to compile the script.
  if (!options || !options.projectDir) {
    return Promise.resolve(query);
  }
  // Resolve the path in case it hasn't been resolved already.
  const projectDir = path.resolve(options.projectDir);
  // Run the bin_loader script if inside bazel, otherwise don't.
  const forkScript = process.env.BAZEL_TARGET ? "../vm/query_bin_loader" : "../vm/query";
  const child = fork(require.resolve(forkScript));
  return new Promise((resolve, reject) => {
    const timeout = 5000;
    const timeoutStart = Date.now();
    const checkTimeout = () => {
      if (child.killed) {
        return;
      }
      if (Date.now() > timeoutStart + timeout) {
        child.kill();
        reject(new Error("Compilation timed out"));
      } else {
        setTimeout(checkTimeout, 100);
      }
    };
    checkTimeout();
    child.on("message", obj => {
      if (!child.killed) {
        child.kill();
      }
      if (obj.err) {
        reject(new Error(obj.err));
      } else {
        resolve(obj.result);
      }
    });
    child.send({ query, projectDir });
  });
}
