var recordBuffers = [],
  eventsList = [],
  sampleRate,

  durationLimit_s = 300, // 默认录音时长限制
  currentDuration_s = 0,
  bufferLenLimit,

  // 点击录音开始时，录音插入的位置
  /*
      每次点击开始录音时都重置初始的插入位置和本次录音的buffer的长度
      用于实现音频定点插入，不是每次都根据slider-bar计算插入位置，计算出的位置存在不准确性
      所以通过该方式只进行一次计算
   */
  insertPostion,
  selectedPercent,
  // 点击录音开始后的当前buffer 总长度，直到下一次点击start时，重置为0；
  currentBufferlenth;

this.onmessage = function(e){
  switch(e.data.command){
    case 'init':
      init(e.data.config);
      break;
    case 'loadAudio':
      loadAudio(e.data.buffer, e.data.eventsList);
      break;
    case 'setVariable':
      setVariable(e.data.positionPercent, e.data.selectedPercent);
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
    default:
      break;
  }
};

function init(config){
  sampleRate = config.sampleRate;
  durationLimit_s = config.durationLimit_s;
  bufferLenLimit = durationLimit_s * sampleRate * 2 ;
}

function loadAudio(inputBuffer, loadedEventsList){
  var bufferL = inputBuffer[0];
  var bufferR = inputBuffer[1];
  var interleaved = interleave(bufferL, bufferR);

  recordBuffers = recordBuffers.concat(interleaved);

  if(JSON.stringify(loadedEventsList) != '{}'){
    eventsList = deconvertEventsList(loadedEventsList, recordBuffers.length);
  }else {
    eventsList[recordBuffers.length - 1] = undefined;    
  }
}

function setVariable(positionPercent, selectedPercentTemp) {
  var recordBuffersLen = recordBuffers.length;

  // 计算新buffer数据插入的位置
  var insertPositionTemp = Math.ceil(positionPercent * recordBuffersLen);
  insertPosition = (insertPositionTemp % 2 == 0) ? insertPositionTemp : insertPositionTemp - 1;
  selectedPercent = selectedPercentTemp;
  
  if(selectedPercent) {
    // 有选区插入时，删除已选内容
    var deleteLen = Math.ceil(selectedPercent * recordBuffersLen);
    deleteLen = (deleteLen % 2 == 0)  ? deleteLen : deleteLen - 1;
    
    // 从buffers删除原有数据
    recordBuffers.splice(insertPosition, deleteLen);
    eventsList.splice(insertPosition, deleteLen);
  }

  // 重置当前buffer长度为0
  currentBufferlenth = 0;
}


function record(inputBuffer, currentEvent){
  var bufferL = inputBuffer[0];
  var bufferR = inputBuffer[1];
  var interleaved = interleave(bufferL, bufferR);

  var interleavedOriginalLen = interleaved.length;

  // 生成事件列表数组
  var tempEventsList = [];
  // tempEventsList.length = interleavedOriginalLen;
  tempEventsList[interleavedOriginalLen - 1] = currentEvent;

  // 如果存在选区，则将选区内容删除(删除操作在setVariable中完成)，将新内容插入
  // interleaved 变换为splice的apply的参数，第二个参数为0
  // 对tempEventsList进行同样的操作
  if(selectedPercent) {
    interleaved.unshift(insertPosition + currentBufferlenth, 0);
    tempEventsList.unshift(insertPosition + currentBufferlenth, 0);
  
  // 如果不存在选区，则将新内容逐步替换
  // interleaved 变换为splice的apply的参数，第二个参数为本次inputBuffer的长度，即interleavedOriginalLen
  }else {
    // interleaved 变换为splice的apply的参数
    // 当insertPosition在末尾时，splice删除的内容超出数组范围，故不会额外删除录制的内容
    interleaved.unshift(insertPosition + currentBufferlenth, interleavedOriginalLen);
    tempEventsList.unshift(insertPosition + currentBufferlenth, interleavedOriginalLen);
  }

  currentBufferlenth += interleavedOriginalLen;
  Array.prototype.splice.apply(recordBuffers, interleaved);
  Array.prototype.splice.apply(eventsList, tempEventsList);

  // count restDuration_s and post message to recorder
  var currentDuration_s = Math.floor(recordBuffers.length / 2 / sampleRate);
  var restDuration_s = durationLimit_s - currentDuration_s  
  if(restDuration_s <= 10) {
    this.postMessage({
      command: 'durationLimit',
      restDuration_s: restDuration_s
    });
    if(restDuration_s <= 0) {
      // 清除多录制的少量音频数据，同时清除多出的eventsList长度
      var dLen = recordBuffers.length - bufferLenLimit;
      recordBuffers.splice(bufferLenLimit, dLen);
      eventsList.splice(bufferLenLimit, dLen);
      return;      
    }
  }
}

function exportWAV(type){
  var buffer = mergeBuffers(recordBuffers);

  var dataview = encodeWAV(buffer);
  var audioBlob = new Blob([dataview], { type: type });

  // 返回事件列表
  this.postMessage({
    command: 'exportWAV',
    audioBlob: audioBlob,
    eventsList: convertEventsList(eventsList),
    samplesCount: recordBuffers.length
  });
}

function getBuffer() {
  var buffer = mergeBuffers(recordBuffers)

  this.postMessage({
    command: 'getBuffer',
    buffer: buffer
  });
}

function clear(){
  recordBuffers = [];
  eventsList = [];
}

function mergeBuffers(recordBuffers){
  var len = recordBuffers.length
  var result = new Float32Array(len);
  result.set(recordBuffers, 0);
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

function convertEventsList(eventsList) {
  var convertedEventsList = {};

  for(var e_i in eventsList) {
    if(eventsList[e_i]) {
      // 接收的eventsList是双声道数组，所以需要除以2
      // 然后处于采样率 48000 得到秒数，再乘以1000得到毫秒
      var ms_index = e_i / 2 / sampleRate * 1000;
      ms_index = Math.round(ms_index);

      convertedEventsList[ms_index] = eventsList[e_i];
    }
  }
  
  return convertedEventsList;
}

function deconvertEventsList(convertedEventsList, len) {
  var eventsList = [];
  eventsList.length = len;
  for(var e_i in convertedEventsList) {
    if(convertedEventsList[e_i]) {
      eventsList[e_i * sampleRate * 2 / 1000] = convertedEventsList[e_i];
    }
  }
  return eventsList;
}