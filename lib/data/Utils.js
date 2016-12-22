var getDeepValue = function(obj, path){
  for (var i=0, path=path.split('.'), len=path.length; i<len; i++){
    obj = obj[path[i]];
  };
  return obj;
};

module.exports = getDeepValue;