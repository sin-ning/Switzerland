import { handler } from '../middleware/rescue/index.js';
import { h, previous, handlers, state } from './index.js';

/**
 * @function dispatchEvent ∷ ∀ a. HTMLElement e ⇒ e → String → Object String a → void
 * ---
 * Dispatches an event, merging in the current package's version for handling legacy events
 * if/when the payloads differ from version-to-version.
 */
export const dispatchEvent = node => (name, payload) => {
    node.dispatchEvent(
        new CustomEvent(name, {
            detail: { ...payload, version: '3.0.0' },
            bubbles: true,
            composed: true
        })
    );
};

/**
 * @function getRandomId ∷ String
 */
export const getRandomId = () => {
    const a = new Uint32Array(1);
    window.crypto.getRandomValues(a);
    return a[0].toString(16);
};

/**
 * @function resolveTagName ∷ String → String → String
 * ---
 * Resolves the node name by first attempting to use the requested node name, unless it already exists as
 * a custom component. If so, we recursively call the `resolveTagName` function to append a random suffix
 * to the end of the node name until we find a node that isn't registered.
 */
export const resolveTagName = (name, suffix = null) => {
    const tag = suffix ? `${name}-${suffix}` : name;
    return !customElements.get(tag) ? tag : resolveTagName(tag, getRandomId());
};

/**
 * @function getEventName ∷ String → String
 * ---
 * Prepends all event names with the '@switzerland' scope.
 */
export const getEventName = label => {
    return `@switzerland/${label}`;
};

/**
 * @function getPrototype ∷ HTMLElement e ⇒ String → e
 * ---
 * Determines which constructor to extend from for the defining of the custom element. In most cases it
 * will be `HTMLElement` unless the user is extending an existing element.
 */
export const getPrototype = tag => {
    return tag ? document.createElement(tag).constructor : HTMLElement;
};

/**
 * @function consoleMessage ∷ String → String → void
 * ---
 * Takes a message and an optional console type for output. During minification this function will be removed
 * from the generated output if 'NODE_ENV' is defined as 'production', as it will be unused due to 'process.env'
 * checks later on in the code.
 */
export const consoleMessage = (text, type = 'error') => {
    console[type](`\uD83C\uDDE8\uD83C\uDDED Switzerland: ${text}.`);
};

/**
 * @function isRemotePath ∷ String → Boolean
 * ---
 * Determines whether the passed paths are remote URLs.
 */
const isRemotePath = path =>
    path.startsWith('http://') ||
    path.startsWith('https://') ||
    path.startsWith('://');

/**
 * @function parseStylesheetPaths ∷ String → String
 * @see https://github.com/website-scraper/node-css-url-parser
 * ---
 * Parses all of the paths defined in the CSS and returns a unique list of the paths found.
 * @TODO: Remove function when specs resolve the problem of loading relative to the module file.
 */
const parseStylesheetPaths = data => {
    const embeddedRegexp = /^data:(.*?),(.*?)/;
    const commentRegexp = /\/\*([\s\S]*?)\*\//g;
    const urlsRegexp = /(?:@import\s+)?url\s*\(\s*(("(.*?)")|('(.*?)')|(.*?))\s*\)|(?:@import\s+)(("(.*?)")|('(.*?)')|(.*?))[\s;]/gi;

    const isEmbedded = src => embeddedRegexp.test(src.trim());

    const getUrls = text => {
        let url;
        let urlMatch;
        const urls = [];

        text = text.replace(commentRegexp, '');

        while ((urlMatch = urlsRegexp.exec(text))) {
            url =
                urlMatch[3] ||
                urlMatch[5] ||
                urlMatch[6] ||
                urlMatch[9] ||
                urlMatch[11] ||
                urlMatch[12];

            if (url && !isEmbedded(url) && urls.indexOf(url) === -1) {
                urls.push(url);
            }
        }

        return urls;
    };

    return getUrls(data).filter(path => !isRemotePath(path));
};

/**
 * @function escapeRegExp ∷ String → String
 * @see https://github.com/sindresorhus/escape-string-regexp
 */
const escapeRegExp = value => value.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&');

/**
 * @function getStylesheet ∷ View v ⇒ (String → String) → String → v
 * ---
 * Takes the `getPath` function which allows for resolving the paths relative to the component. Also
 * takes the path to the CSS document(s) that is fetched, its URLs parsed, and then modified to be
 * relative to the CSS document. Yields the `style` ready for appending to the VDOM tree.
 */
export const getStylesheet = getPath => async path => {
    const data = await fetch(getPath(path)).then(r => r.text());
    const urls = parseStylesheetPaths(data);

    const css = urls.length
        ? urls
              .map(url => {
                  return data.replace(
                      new RegExp(escapeRegExp(url), 'ig'),
                      getPath(url)
                  );
              })
              .join()
        : data;

    return h('style', { type: 'text/css' }, css);
};

/**
 * @function getInitialProps ∷ HTMLElement e, Props p ⇒ e → p → Promise (void) → p
 */
export const getInitialProps = (node, mergeProps, scheduledTask) => {
    const prevProps = previous.get(node);

    const isResolved = async () => {
        const resolution = await Promise.race([
            scheduledTask,
            Promise.resolve(false)
        ]);
        return resolution !== false;
    };
    return {
        ...(prevProps || {}),
        ...mergeProps,
        isResolved,
        node,
        render: node.render.bind(node),
        dispatch: dispatchEvent,
        prevProps: previous.get(node) || null
    };
};

/**
 * @function processMiddleware ∷ HTMLElement e, Props p ⇒ e → p → [(p → Promise p|p)] → p
 */
export const processMiddleware = async (node, initialProps, middleware) => {
    const props = await middleware.reduce(async (accumP, middleware) => {
        const props = await accumP;
        const newProps = middleware({
            ...props,
            props
        });

        // Determine if there's an error handler in the current set of props. If there is then
        // set the handler function as the default to be used if an error is subsequently thrown.
        handler in newProps && handlers.set(node, newProps);
        return newProps;
    }, initialProps);

    previous.set(node, props);
    return props;
};

/**
 * @function handleError ∷ ∀ a. HTMLElement e ⇒ e → Error a → void
 */
export const handleError = (node, error) => {
    // Attempt to find an error handler for the current node which can handle the error gracefully.
    // Otherwise a simple yet abrasive `console.error` will be used with no recovery possible.
    const props = handlers.get(node);

    if (!props) {
        consoleMessage(error);
        return;
    }

    previous.set(node, { ...props, error });
    props[handler]({
        ...props,
        error,
        render: mergeProps => {
            node[state] = 'normal';
            node.render(mergeProps);
        }
    });
};