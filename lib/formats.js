'use strict';
// Extensions are registration hints; both parsers inspect the actual container bytes.
const EXTENSIONS = ['mp3','mp2','mp1','m2a','aac','ac3','eac3','ec3','flac','ogg','oga','opus','spx','wav','wave','bwf','aif','aiff','aifc','m4a','m4b','m4r','3gp','m4p','mp4','alac','wma','asf','ape','wv','wvp','mpc','mpp','mp+','tta','dsf','dff','mka','mkv','webm','caf','caff','shn'];
const LEGACY = ['mp3','mp2','aac','ac3','eac3','ec3','flac'];
const ALIASES={mp1:'mp3',m2a:'mp2',bwf:'wav',wvp:'wv',mpp:'mpc','mp+':'mpc',m4r:'m4a','3gp':'mp4',caff:'caf'};
module.exports = { EXTENSIONS, LEGACY, ALIASES };
