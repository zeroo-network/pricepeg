"use strict";
var Utils_1 = require("./data/Utils");
var Q = require('q');
var config_1 = require("./config");
var BittrexDataSource_1 = require("./data/BittrexDataSource");
var PoloniexDataSource_1 = require("./data/PoloniexDataSource");
var CoinbaseDataSource_1 = require("./data/CoinbaseDataSource");
var FixerFiatDataSource_1 = require("./data/FixerFiatDataSource");
var CurrencyConversion_1 = require("./data/CurrencyConversion");
var syscoin = require('syscoin');
var client = new syscoin.Client({
    host: config_1.default.rpcserver,
    port: config_1.default.rpcport,
    user: config_1.default.rpcuser,
    pass: config_1.default.rpcpassword,
    timeout: config_1.default.rpctimeout
});
//holds mock peg data for sync testing
var mockPeg = {
    "rates": [
        { "currency": "USD", "rate": 0.5, "escrowfee": 0.005, "precision": 2 },
        { "currency": "EUR", "rate": 2695.2, "escrowfee": 0.005, "precision": 2 },
        { "currency": "GBP", "rate": 2697.3, "escrowfee": 0.005, "precision": 2 },
        { "currency": "CAD", "rate": 2698.0, "escrowfee": 0.005, "precision": 2 },
        { "currency": "BTC", "rate": 100000.0, "fee": 75, "escrowfee": 0.01, "precision": 8 },
        { "currency": "ZEC", "rate": 10000.0, "fee": 50, "escrowfee": 0.01, "precision": 8 },
        { "currency": "SYS", "rate": 1.0, "fee": 1000, "escrowfee": 0.005, "precision": 2 }
    ]
};
var PricePeg = (function () {
    function PricePeg() {
        var _this = this;
        this.startTime = null;
        this.updateHistory = [];
        this.sysRates = null;
        this.sysBTCConversionValue = 0;
        this.sysZECConversionValue = 0;
        this.btcUSDConversionValue = 0;
        this.updateInterval = null;
        this.fiatDataSource = new FixerFiatDataSource_1.default("USD", "US Dollar", "http://api.fixer.io/latest?base=USD");
        this.SYSBTCConversionCache = [
            new BittrexDataSource_1.default(CurrencyConversion_1.CurrencyConversionType.CRYPTO.SYS, "ZCash", "https://bittrex.com/api/v1.1/public/getticker?market=BTC-SYS", "result.Bid"),
            new PoloniexDataSource_1.default(CurrencyConversion_1.CurrencyConversionType.CRYPTO.SYS, "Syscoin", "https://poloniex.com/public?command=returnTicker", "BTC_SYS.last")
        ];
        this.ZECBTCConversionCache = [
            new BittrexDataSource_1.default(CurrencyConversion_1.CurrencyConversionType.CRYPTO.ZEC, "Zcash", "https://bittrex.com/api/v1.1/public/getticker?market=BTC-ZEC", "result.Bid"),
            new PoloniexDataSource_1.default(CurrencyConversion_1.CurrencyConversionType.CRYPTO.ZEC, "ZCash", "https://poloniex.com/public?command=returnTicker", "BTC_ZEC.last")
        ];
        this.BTCFiatConversionCache = [
            new CoinbaseDataSource_1.default("USD", "US Dollar", "https://coinbase.com/api/v1/currencies/exchange_rates")
        ];
        this.start = function () {
            Utils_1.logPegMessage("Starting PricePeg with config: \n" + JSON.stringify(config_1.default));
            if (config_1.default.enableLivePegUpdates)
                client.getInfo(function (err, info, resHeaders) {
                    if (err) {
                        return Utils_1.logPegMessage("Error: " + err);
                    }
                    Utils_1.logPegMessage('Syscoin Connection Test. Current Blockheight: ' + info.blocks);
                });
            _this.startTime = Date.now();
            _this.startUpdateInterval();
        };
        this.stop = function () {
            _this.stopUpdateInterval();
        };
        this.startUpdateInterval = function () {
            _this.fiatDataSource.fetchCurrencyConversionData().then(function (result) {
                if (!config_1.default.enablePegUpdateDebug) {
                    _this.refreshCache(true);
                    _this.updateInterval = setInterval(function () {
                        _this.refreshCache(true);
                    }, config_1.default.updateInterval * 1000);
                }
                else {
                    _this.checkPricePeg();
                    _this.updateInterval = setInterval(function () {
                        _this.checkPricePeg();
                    }, config_1.default.debugPegUpdateInterval * 1000);
                }
            });
        };
        this.stopUpdateInterval = function () {
            clearInterval(_this.updateInterval);
        };
        this.refreshCache = function (checkForPegUpdate) {
            var dataSources = _this.SYSBTCConversionCache.concat(_this.ZECBTCConversionCache.concat(_this.BTCFiatConversionCache));
            dataSources = dataSources.map(function (item) { return item.fetchCurrencyConversionData(); });
            Q.all(dataSources).then(function (resultsArr) {
                _this.handleCacheRefreshComplete(checkForPegUpdate);
            });
        };
        this.handleCacheRefreshComplete = function (checkForPegUpdate) {
            //any time we fetch crypto rates, fetch the fiat rates too
            Utils_1.logPegMessage("Cache refresh completed, check for peg value changes == " + checkForPegUpdate);
            Utils_1.logPegMessageNewline();
            _this.fiatDataSource.fetchCurrencyConversionData().then(function (result) {
                _this.sysBTCConversionValue = _this.getSYSBTCAverage();
                _this.sysZECConversionValue = _this.getSYSZECAverage();
                _this.btcUSDConversionValue = _this.getBTCUSDAverage();
                _this.getSYSFiatValue(CurrencyConversion_1.CurrencyConversionType.FIAT.USD);
                if (checkForPegUpdate) {
                    _this.checkPricePeg();
                }
            });
        };
        this.checkPricePeg = function () {
            var deferred = Q.defer();
            _this.getPricePeg().then(function (currentValue) {
                Utils_1.logPegMessage("Current peg value: " + JSON.stringify(currentValue));
                if (_this.sysRates == null) {
                    Utils_1.logPegMessage("No current value set, setting, setting first result as current value.");
                    _this.sysRates = currentValue;
                }
                Utils_1.logPegMessageNewline();
                var newValue = _this.convertToPricePeg();
                if (config_1.default.enablePegUpdateDebug) {
                    _this.setPricePeg(newValue, currentValue);
                }
                else {
                    var percentChange = 0;
                    if (newValue.rates[0].rate != currentValue.rates[0].rate) {
                        percentChange = ((newValue.rates[0].rate - currentValue.rates[0].rate) / currentValue.rates[0].rate) * 100;
                    }
                    Utils_1.logPegMessage("Checking price. Current v. new = " + currentValue.rates[0].rate + " v. " + newValue.rates[0].rate + " == " + percentChange + "% change");
                    Utils_1.logPegMessageNewline();
                    percentChange = percentChange < 0 ? percentChange * -1 : percentChange; //convert neg percent to positive
                    if (percentChange > (config_1.default.updateThresholdPercentage * 100)) {
                        Utils_1.logPegMessage("Attempting to update price peg.");
                        _this.setPricePeg(newValue, currentValue).then(function (result) {
                            deferred.resolve(result);
                        });
                    }
                    else {
                        deferred.resolve();
                    }
                }
            })
                .catch(function (err) {
                Utils_1.logPegMessage("ERROR:" + err);
                deferred.reject(err);
            });
            return deferred.promise;
        };
        this.getPricePeg = function () {
            var deferred = Q.defer();
            if (!config_1.default.enableLivePegUpdates) {
                deferred.resolve(mockPeg);
            }
            else {
                client.aliasInfo(config_1.default.pegalias, function (err, aliasinfo, resHeaders) {
                    if (err) {
                        Utils_1.logPegMessage("Error: " + err);
                        return deferred.reject(err);
                    }
                    deferred.resolve(JSON.parse(aliasinfo.value));
                });
            }
            return deferred.promise;
        };
        this.setPricePeg = function (newValue, oldValue) {
            var deferred = Q.defer();
            //guard against updating the peg too rapidly
            var now = Date.now();
            var currentInterval = (1000 * 60 * 60 * 24) + (now - _this.startTime);
            currentInterval = (currentInterval / (config_1.default.updatePeriod * 1000)) % 1; //get remainder of unfinished interval
            //see how many updates have happened in this period
            var currentIntervalStartTime = now - ((config_1.default.updatePeriod * 1000) * currentInterval);
            var updatesInThisPeriod = 0;
            Utils_1.logPegMessage("Attempting to update price peg if within safe parameters.");
            updatesInThisPeriod += _this.updateHistory.filter(function (item) {
                return item.date > currentIntervalStartTime;
            }).length;
            if (updatesInThisPeriod <= config_1.default.maxUpdatesPerPeriod) {
                if (config_1.default.enableLivePegUpdates) {
                    client.aliasUpdate(config_1.default.pegalias, config_1.default.pegalias_aliaspeg, JSON.stringify(newValue), function (err, result, resHeaders) {
                        if (err) {
                            Utils_1.logPegMessage("ERROR:" + err);
                            Utils_1.logPegMessageNewline();
                            deferred.reject(err);
                        }
                        else {
                            _this.logUpdate(newValue, oldValue); //always store the pre-update value so it makes sense when displayed
                            deferred.resolve(result);
                        }
                    });
                }
                else {
                    _this.logUpdate(newValue, oldValue);
                    deferred.resolve(newValue);
                }
            }
            else {
                Utils_1.logPegMessage("ERROR - Unable to update peg, max updates of [" + config_1.default.maxUpdatesPerPeriod + "] would be exceeded. Not updating peg.");
                Utils_1.logPegMessageNewline();
                deferred.reject();
            }
            return deferred.promise;
        };
        this.logUpdate = function (newValue, oldValue) {
            //store prev value
            _this.updateHistory.push({
                date: Date.now(),
                value: oldValue
            });
            _this.sysRates = newValue;
            Utils_1.logPegMessage("Price peg updated successfully.");
            Utils_1.logPegMessageNewline();
        };
        this.getFiatRate = function (usdRate, conversionRate, precision) {
            var rate = 0;
            rate = usdRate / conversionRate;
            return _this.getFixedRate(rate, precision);
        };
        this.getSYSFiatValue = function (fiatType) {
            var convertedValue;
            switch (fiatType) {
                case "USD":
                    convertedValue = 1 / _this.btcUSDConversionValue;
                    convertedValue = convertedValue / _this.sysBTCConversionValue;
                    break;
            }
            //if debug is enabled artificially increment by config'd amount
            if (config_1.default.enablePegUpdateDebug) {
                convertedValue = _this.sysRates.rates[0].rate + config_1.default.debugPegUpdateIncrement;
            }
            return convertedValue;
        };
        this.getFixedRate = function (rate, precision) {
            return parseFloat(parseFloat(rate).toFixed(precision));
        };
        this.convertToPricePeg = function () {
            return {
                rates: [
                    {
                        currency: CurrencyConversion_1.CurrencyConversionType.FIAT.USD,
                        rate: _this.getFixedRate(_this.getSYSFiatValue(CurrencyConversion_1.CurrencyConversionType.FIAT.USD), 2),
                        precision: 2
                    },
                    {
                        "currency": CurrencyConversion_1.CurrencyConversionType.FIAT.EUR,
                        "rate": _this.getFiatRate(_this.getSYSFiatValue(CurrencyConversion_1.CurrencyConversionType.FIAT.USD), _this.fiatDataSource.formattedCurrencyConversionData.EUR, 2),
                        "escrowfee": 0.005,
                        "precision": 2
                    },
                    {
                        "currency": CurrencyConversion_1.CurrencyConversionType.FIAT.GBP,
                        "rate": _this.getFiatRate(_this.getSYSFiatValue(CurrencyConversion_1.CurrencyConversionType.FIAT.USD), _this.fiatDataSource.formattedCurrencyConversionData.GBP, 2),
                        "escrowfee": 0.005,
                        "precision": 2
                    },
                    {
                        "currency": CurrencyConversion_1.CurrencyConversionType.FIAT.CAD,
                        "rate": _this.getFiatRate(_this.getSYSFiatValue(CurrencyConversion_1.CurrencyConversionType.FIAT.USD), _this.fiatDataSource.formattedCurrencyConversionData.CAD, 2),
                        "escrowfee": 0.005,
                        "precision": 2
                    },
                    {
                        "currency": CurrencyConversion_1.CurrencyConversionType.FIAT.CNY,
                        "rate": _this.getFiatRate(_this.getSYSFiatValue(CurrencyConversion_1.CurrencyConversionType.FIAT.USD), _this.fiatDataSource.formattedCurrencyConversionData.CNY, 4),
                        "escrowfee": 0.005,
                        "precision": 4
                    },
                    {
                        "currency": CurrencyConversion_1.CurrencyConversionType.CRYPTO.BTC,
                        "rate": _this.getFixedRate(1 / parseFloat(_this.sysBTCConversionValue.toString()), 8),
                        "escrowfee": 0.01,
                        "fee": 75,
                        "precision": 8
                    },
                    {
                        "currency": CurrencyConversion_1.CurrencyConversionType.CRYPTO.ZEC,
                        "rate": _this.getFixedRate(parseFloat(_this.sysZECConversionValue.toString()), 8),
                        "escrowfee": 0.01,
                        "fee": 50,
                        "precision": 8
                    },
                    {
                        "currency": CurrencyConversion_1.CurrencyConversionType.CRYPTO.SYS,
                        "rate": _this.getFixedRate(1.0, 2),
                        "escrowfee": 0.005,
                        "fee": 1000,
                        "precision": 2
                    }
                ]
            };
        };
        this.getSYSBTCAverage = function (amount) {
            if (amount === void 0) { amount = 1; }
            //first get the average across all the conversions
            var avgSum = 0;
            for (var i = 0; i < _this.SYSBTCConversionCache.length; i++) {
                avgSum += _this.SYSBTCConversionCache[i].formattedCurrencyConversionData.toCurrencyAmount;
            }
            var avgVal = avgSum / _this.SYSBTCConversionCache.length;
            return avgVal * amount;
        };
        this.getSYSZECAverage = function (amount) {
            if (amount === void 0) { amount = 1; }
            //first get the average across all the conversions
            var avgSum = 0;
            for (var i = 0; i < _this.ZECBTCConversionCache.length; i++) {
                avgSum += _this.ZECBTCConversionCache[i].formattedCurrencyConversionData.toCurrencyAmount;
            }
            var avgZECVal = avgSum / _this.ZECBTCConversionCache.length;
            var avgSYSVal = _this.getSYSBTCAverage(amount);
            var avgVal = avgZECVal / avgSYSVal;
            return avgVal * amount;
        };
        this.getBTCUSDAverage = function (amount) {
            if (amount === void 0) { amount = 1; }
            //first get the average across all the conversions
            var avgSum = 0;
            for (var i = 0; i < _this.BTCFiatConversionCache.length; i++) {
                avgSum += _this.BTCFiatConversionCache[i].formattedCurrencyConversionData.toCurrencyAmount;
            }
            var avgVal = avgSum / _this.BTCFiatConversionCache.length;
            return avgVal * amount;
        };
        if (!config_1.default.enableLivePegUpdates) {
            this.fiatDataSource.formattedCurrencyConversionData = mockPeg;
        }
    }
    return PricePeg;
}());
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = PricePeg;
;
