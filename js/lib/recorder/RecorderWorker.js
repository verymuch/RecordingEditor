var recLength = 0,
  eventsList = [],
  recBuffers = [],
  sampleRate,
  /*
      每次点击都重置初始的插入位置和本次录音的buffer的长度
      用于实现音频定点插入，不是每次都根据slider-bar计算插入位置，计算出的位置存在不准确性
      所以通过该方式只进行一次计算
   */
  // 点击录音开始时，录音插入的位置
  insertPostion,
  // 点击录音开始后的当前buffer 总长度，直到下一次点击start时，重置为0；
  currentBufferlenth,
  secondsLimit = 300,
  bufferLenLimit;

this.onmessage = function(e){
  switch(e.data.command){
    case 'init':
      init(e.data.config);
      break;
    case 'loadAudio':
      loadAudio(e.data.buffer);
      break;
    case 'insert':
      insert(e.data.positionPercent, e.data.selectedPercent);
      break;
    case 'record':
      record(e.data.buffer, e.data.currentEvent);
      break;
    case 'exportWAV':
      exportWAV(e.data.type);
      break;
    case 'getBuffer':
      getBuffer();
      break;
    case 'clear':
      clear();
      break;
  }
};

function init(config){
  sampleRate = config.sampleRate;
  bufferLenLimit = secondsLimit * sampleRate * 2 ;
}

function loadAudio(inputBuffer){
  var bufferL = inputBuffer[0];
  var bufferR = inputBuffer[1];
  var interleaved = interleave(bufferL, bufferR);

  recBuffers = recBuffers.concat(interleaved);

  // eventsList.length = recBuffers.length;
  eventsList[recBuffers.length - 1] = undefined;

  // recBuffers.push(interleaved);
  // recLength += interleaved.length;
}

function insert(positionPercent, selectedPercent) {
  var recBuffersLen = recBuffers.length;
  // 计算新buffer数据插入的位置
  var insertPositionTemp = Math.ceil(positionPercent * recBuffersLen);
  insertPosition = (insertPositionTemp % 2 == 0) ? insertPositionTemp : insertPositionTemp - 1;

  // 有选区插入时，删除已选内容
  var deleteLen = Math.ceil(selectedPercent * recBuffersLen);
  deleteLen = (deleteLen % 2 == 0)  ? deleteLen : deleteLen - 1;

  // 从buffers删除原有数据
  recBuffers.splice(insertPosition, deleteLen);

  eventsList.splice(insertPosition, deleteLen);


  // 重置当前buffer长度为0
  currentBufferlenth = 0;
}


function record(inputBuffer, currentEvent){
  if(recBuffers.length >= bufferLenLimit) {
    var exceedLimit = true;
    var data = {
      'exceedLimit': exceedLimit
    };
    this.postMessage(data);
    return ;
  }

  var bufferL = inputBuffer[0];
  var bufferR = inputBuffer[1];
  var interleaved = interleave(bufferL, bufferR);

  var interleavedOriginalLen = interleaved.length;

  // debugger;

  // interleaved 变换为splice的apply的参数
  interleaved.unshift(insertPosition + currentBufferlenth, 0);

  // 生成事件列表数组
  var tempEventsList = [];
  // tempEventsList.length = interleavedOriginalLen;
  tempEventsList[interleavedOriginalLen - 1] = currentEvent;
  tempEventsList.unshift(insertPosition + currentBufferlenth, 0);

  // 加上处理的buffer长度，但是要减去2，因为unshift加入了两个元素
  // currentBufferlenth += (interleaved.length - 2);
  currentBufferlenth += interleavedOriginalLen;
  Array.prototype.splice.apply(recBuffers, interleaved);
  Array.prototype.splice.apply(eventsList, tempEventsList);


  // recBuffers.push(interleaved);

  // recBuffers = recBuffers.concat(interleaved);
  
  // recBuffers.push(interleaved);
  // recLength += interleaved.length;
}

function exportWAV(type){
  // var buffer = mergeBuffers(recBuffers, recLength);
  var buffer = mergeBuffers(recBuffers);

  var dataview = encodeWAV(buffer);
  var audioBlob = new Blob([dataview], { type: type });

  var data = {
    audioBlob: audioBlob,
    eventsList: eventsList,
    len: recBuffers.length
  }

  // 返回事件列表
  // this.postMessage(audioBlob);
  this.postMessage(data);
}

function getBuffer() {
  // var buffer = mergeBuffers(recBuffers, recLength)
  var buffer = mergeBuffers(recBuffers)

  this.postMessage(buffer);
}

function clear(){
  recLength = 0;
  recBuffers = [];
}

function mergeBuffers(recBuffers){
  // var result = new Float32Array(recLength);
  // var offset = 0;
  // for (var i = 0; i < recBuffers.length; i++){
  //   result.set(recBuffers[i], offset);
  //   offset += recBuffers[i].length;
  // }
  // return result;
  var len = recBuffers.length
  var result = new Float32Array(len);
  result.set(recBuffers, 0);
  return result;
}

function interleave(inputL, inputR){
  var length = inputL.length + inputR.length;
  // 需要多interleave后的数组进行数组相关操作，此处稍作调整
  // var result = new Float32Array(length);
  var result = [];

  var index = 0,
    inputIndex = 0;

  while (index < length){
    result[index++] = inputL[inputIndex];
    result[index++] = inputR[inputIndex];
    inputIndex++;
  }
  return result;
}

function floatTo16BitPCM(output, offset, input){
  for (var i = 0; i < input.length; i++, offset+=2){
    var s = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
}

function writeString(view, offset, string){
  for (var i = 0; i < string.length; i++){
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function encodeWAV(samples){
  var buffer = new ArrayBuffer(44 + samples.length * 2);
  var view = new DataView(buffer);

  /* RIFF identifier */
  writeString(view, 0, 'RIFF');
  /* file length */
  view.setUint32(4, 32 + samples.length * 2, true);
  /* RIFF type */
  writeString(view, 8, 'WAVE');
  /* format chunk identifier */
  writeString(view, 12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw) */
  view.setUint16(20, 1, true);
  /* channel count */
  view.setUint16(22, 2, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * 4, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, 4, true);
  /* bits per sample */
  view.setUint16(34, 16, true);
  /* data chunk identifier */
  writeString(view, 36, 'data');
  /* data chunk length */
  view.setUint32(40, samples.length * 2, true);

  floatTo16BitPCM(view, 44, samples);

  return view;
}
