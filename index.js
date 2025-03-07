const axios = require('axios');
const createHmac = require('create-hmac');
const OAuth = require('oauth-1.0a');
const Url = require('url-parse');

/**
 * Options Exception.
 */
class OptionsException {
    /**
     * Constructor.
     * @param {String} message
     */
    constructor(message) {
        this.name = 'Options Error';
        this.message = message;
    }
}

/**
 * WooCommerce REST API wrapper
 * @param {Object} opt
 */
class WooCommerceRestApi {
    /**
     * Class constructor.
     * @param {Object} [options]
     */
    constructor(options) {
        if (!(this instanceof WooCommerceRestApi)) return new WooCommerceRestApi(options);
        options = options || { };
        if (!options.url) throw new OptionsException('url is required');
        if (!options.consumerKey) throw new OptionsException('consumerKey is required');
        if (!options.consumerSecret) throw new OptionsException('consumerSecret is required');
        this.classVersion = '1.0.4';
        this.#setDefaultOptions(options);
    }

    /**
     * DELETE requests
     * @param  {String} endpoint
     * @param  {Object} [params]
     * @returns {Promise<Object>}
     */
    delete(endpoint, params) {
        return this.#request('delete', endpoint, null, params);
    }

    /**
     * GET requests
     * @param  {String} endpoint
     * @param  {Object} [params]
     * @return {Promise<Object>}
     */
    get(endpoint, params) {
        return this.#request('get', endpoint, null, params);
    }

    /**
     * Get OAuth
     * @return {Object}
     */
    #getOAuth() {
        const data = {
            consumer: {
                key: this.consumerKey,
                secret: this.consumerSecret,
            },
            signature_method: 'HMAC-SHA256',
            hash_function: (base, key) => {
                return createHmac('sha256', key).update(base).digest('base64');
            }
        };
        return new OAuth(data);
    }

    /**
     * Get URL
     * @param  {String} endpoint
     * @param  {Object} [params]
     * @return {String}
     */
    #getUrl(endpoint, params) {
        const api = this.wpAPIPrefix + '/';
        let url = (this.url.slice(-1) === '/') ? this.url : this.url + '/';
        url = url + api + this.version + '/' + endpoint;

        // Include port.
        if (this.port !== '') {
            const hostname = new Url(url).hostname;
            url = url.replace(hostname, hostname + ':' + this.port);
        }
        if (!this.isHttps) return this.#normalizeQueryString(url, params);
        return url;
    }

    /**
     * Normalize query string for oAuth
     * @param  {String} url
     * @param  {Object} [params]
     * @return {String}
     */
    #normalizeQueryString(url, params) {
        params = params || { };
        // Exit if don't find query string.
        if ((url.indexOf('?') === -1) && (Object.keys(params).length === 0)) {
            return url;
        }
        const query = new Url(url, null, true).query;
        const values = [ ];
        let queryString = '';
        // Include params object into URL.searchParams.
        this.#parseParamsObject(params, query);
        for (const key in query) {
            values.push(key);
        }
        values.sort();
        for (const key in values) {
            if (queryString.length) {
                queryString += '&';
            }
            queryString += encodeURIComponent(values[ key ]).replace(/%5B/g, '[').replace(/%5D/g, ']');
            queryString += '=';
            queryString += encodeURIComponent(query[ values[ key ] ]);
        }
        return url.split('?')[ 0 ] + '?' + queryString;
    }

    /**
     * OPTIONS requests
     * @param  {String} endpoint
     * @param  {Object} [params]
     * @return {Promise<Object>}
     */
    options(endpoint, params) {
        return this.#request('options', endpoint, null, params);
    }

    /**
     * Parse params object.
     * @param {Object} params
     * @param {Object} query
     */
    #parseParamsObject(params, query) {
        for (const key in params) {
            const value = params[ key ];
            if (typeof value === 'object') {
                for (const prop in value) {
                    const itemKey = key.toString() + '[' + prop.toString() + ']';
                    query[ itemKey ] = value[ prop ];
                }
            } else {
                query[ key ] = value;
            }
        }
        return query;
    }

    /**
     * POST requests
     * @param  {String} endpoint
     * @param  {Object} [data]
     * @param  {Object} [params]
     * @return {Promise<Object>}
     */
    post(endpoint, data, params) {
        return this.#request('post', endpoint, data, params);
    }

    /**
     * PUT requests
     * @param  {String} endpoint
     * @param  {Object} [data]
     * @param  {Object} [params]
     * @return {Promise<Object>}
     */
    put(endpoint, data, params) {
        return this.#request('put', endpoint, data, params);
    }

    /**
     * Do requests
     * @param  {String} method
     * @param  {String} endpoint
     * @param  {Object} [data]
     * @param  {Object} [params]
     * @return {Promise<Object>}
     */
    #request(method, endpoint, data, params) {
        const url = this.#getUrl(endpoint, params);
        let options = {
            url: url,
            method: method,
            responseEncoding: this.encoding,
            timeout: this.timeout,
            responseType: 'json',
            headers: {
                'User-Agent': 'WooCommerce REST API - JS Client/' + this.classVersion,
                Accept: 'application/json',
            },
        };
        if (this.isHttps) {
            if (this.queryStringAuth) {
                options.params = {
                    consumer_key: this.consumerKey,
                    consumer_secret: this.consumerSecret,
                };
            } else {
                options.auth = {
                    username: this.consumerKey,
                    password: this.consumerSecret,
                };
            }
            options.params = {
                ...options.params,
                ...params,
            };
        } else {
            options.params = this.#getOAuth().authorize({
                url: url,
                method: method,
            });
        }
        if (data) {
            options.headers[ 'Content-Type' ] = 'application/json;charset=utf-8';
            options.data = JSON.stringify(data);
        }

        // Allow set and override Axios options.
        const config = {
            ...this.axiosConfig,
            ...options,
        };
        const instance = axios.create();
        this.#setupInterceptors(instance);
        return instance(config);
    }

    /**
     * Set default options
     * @param {Object} [options]
     */
    #setDefaultOptions(options) {
        options = options || { };
        this.url = options.url;
        this.wpAPIPrefix = options.wpAPIPrefix || 'wp-json';
        this.version = options.version || 'wc/v3';
        this.isHttps = /^https/i.test(this.url);
        this.consumerKey = options.consumerKey;
        this.consumerSecret = options.consumerSecret;
        this.encoding = options.encoding || 'utf8';
        this.queryStringAuth = options.queryStringAuth || false;
        this.port = options.port || '';
        this.timeout = options.timeout;
        this.axiosConfig = options.axiosConfig || { };
    }

    #setupInterceptors(instance) {
        instance.interceptors.request.use(
            (config) => {
                const newConfig = { ...config };
                newConfig.metadata = { startTime: new Date() };
                return newConfig;
            },
        );
        instance.interceptors.response.use(
            (response) => {
                const newResponse = { ...response };
                newResponse.config.metadata.endTime = new Date();
                newResponse.duration = newResponse.config.metadata.endTime - newResponse.config.metadata.startTime;
                return newResponse;
            },
            (error) => {
                const newError = { ...error };
                newError.config.metadata.endTime = new Date();
                newError.duration = newError.config.metadata.endTime - newError.config.metadata.startTime;
                return Promise.reject(newError);
            },
        );
    }
}

module.exports = {
    OptionsException,
    WooCommerceRestApi,
};
