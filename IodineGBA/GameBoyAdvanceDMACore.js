"use strict";
/*
 * This file is part of IodineGBA
 *
 * Copyright (C) 2012-2013 Grant Galitz
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License
 * version 2 as published by the Free Software Foundation.
 * The full license is available at http://www.gnu.org/licenses/gpl.html
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 */
function GameBoyAdvanceDMA(IOCore) {
	this.IOCore = IOCore;
	this.memory = this.IOCore.memory;
	this.emulatorCore = IOCore.emulatorCore;
	this.initialize();
}
GameBoyAdvanceDMA.prototype.DMA_ENABLE_TYPE = [
	[			//DMA Channel 0 Mapping:
		0x1,
		0x2,
		0x4,
		0
	],
	[			//DMA Channel 1 Mapping:
		0x1,
		0x2,
		0x4,
		0x8
	],
	[			//DMA Channel 2 Mapping:
		0x1,
		0x2,
		0x4,
		0x10
	],
	[			//DMA Channel 3 Mapping:
		0x1,
		0x2,
		0x4,
		0x20
	],
];
GameBoyAdvanceDMA.prototype.DMA_REQUEST_TYPE = {
	PROHIBITED:		0,
	IMMEDIATE:		0x1,
	V_BLANK:		0x2,
	H_BLANK:		0x4,
	FIFO_A:			0x8,
	FIFO_B:			0x10,
	DISPLAY_SYNC:	0x20,
	GAME_PAK:		0x40
}
GameBoyAdvanceDMA.prototype.initialize = function () {
	this.enabled = [0, 0, 0, 0];
	this.pending = [0, this.DMA_REQUEST_TYPE.FIFO_A, this.DMA_REQUEST_TYPE.FIFO_B, 0];
	this.source = [0, 0, 0, 0];
	this.sourceShadow = [0, 0, 0, 0];
	this.destination = [0, 0, 0, 0];
	this.destinationShadow = [0, 0, 0, 0];
	this.wordCount = [0, 0, 0, 0];
	this.wordCountShadow = [0, 0, 0, 0];
	this.control = [
		[false, 0, false, false, 0, 0],
		[false, 0, false, false, 0, 0],
		[false, 0, false, false, 0, 0],
		[false, 0, false, false, 0, 0]
	];
	this.controlShadow = [
		[false, 0, false, false, 0, 0],
		[false, 0, false, false, 0, 0],
		[false, 0, false, false, 0, 0],
		[false, 0, false, false, 0, 0]
	];
	//Game Pak DMA flag for DMA 3:
	this.gamePakDMA = false;
	this.currentMatch = -1;
	this.lastCurrentMatch = -1;
}
GameBoyAdvanceDMA.prototype.writeDMASource = function (dmaChannel, byteNumber, data) {
	this.source[dmaChannel] &= ~(0xFF << (byteNumber << 3));
	this.source[dmaChannel] |= data << (byteNumber << 3);
}
GameBoyAdvanceDMA.prototype.writeDMADestination = function (dmaChannel, byteNumber, data) {
	this.destination[dmaChannel] &= ~(0xFF << (byteNumber << 3));
	this.destination[dmaChannel] |= data << (byteNumber << 3);
}
GameBoyAdvanceDMA.prototype.writeDMAWordCount0 = function (dmaChannel, data) {
	this.wordCount[dmaChannel] &= 0xFF00;
	this.wordCount[dmaChannel] |= data;
}
GameBoyAdvanceDMA.prototype.writeDMAWordCount1 = function (dmaChannel, data) {
	this.wordCount[dmaChannel] &= 0xFF;
	this.wordCount[dmaChannel] |= data << 8;
}
GameBoyAdvanceDMA.prototype.writeDMAControl0 = function (dmaChannel, data) {
	var control = this.control[dmaChannel];
	control[5] = (data >> 5) & 0x3;
	control[4] &= 0x2;
	control[4] |= (data >> 7) & 0x1;
}
GameBoyAdvanceDMA.prototype.readDMAControl0 = function (dmaChannel) {
	var control = this.control[dmaChannel];
	return ((control[4] & 0x01) << 7) | (control[5] << 5);
}
GameBoyAdvanceDMA.prototype.writeDMAControl1 = function (dmaChannel, data) {
	var control = this.control[dmaChannel];
	control[4] &= 0x1;
	control[4] |= (data & 0x1) << 1;
	control[3] = ((data & 0x2) == 0x2);
	control[2] = ((data & 0x4) == 0x4);
	if (dmaChannel == 3) {
		this.gamePakDMA = ((data & 0x8) == 0x8);
	}
	control[1] = (data >> 4) & 0x3;
	control[0] = ((data & 0x40) == 0x40);
	if (data > 0x7F) {
		if (this.enabled[dmaChannel] == 0) {
			this.enabled[dmaChannel] = this.DMA_ENABLE_TYPE[dmaChannel][control[1]];
			this.enableDMAChannel(dmaChannel);
		}
	}
	else {
		this.enabled[dmaChannel] = 0;
	}
}
GameBoyAdvanceDMA.prototype.readDMAControl1 = function (dmaChannel) {
	var control = this.control[dmaChannel];
	return (((this.enabled[dmaChannel] > 0) ? 0x80 : 0) |
			((control[0]) ? 0x40 : 0) |
			(control[1] << 4) |
			((dmaChannel == 3 && this.gamePakDMA) ? 0x8 : 0) |
			((control[2]) ? 0x4 : 0) |
			((control[3]) ? 0x2 : 0) |
			(control[4] >> 1)
	);
}
GameBoyAdvanceDMA.prototype.enableDMAChannel = function (dmaChannel) {
	//Emulate the DMA preprocessing that occurs on DMA enabling:
	var control = this.control[dmaChannel];
	var controlShadow = this.controlShadow[dmaChannel];
	var sourceShadow = this.source[dmaChannel];
	var destinationShadow = this.destination[dmaChannel];
	var wordCountShadow = this.wordCount[dmaChannel];
	controlShadow[0] = control[0];
	controlShadow[1] = control[1];
	controlShadow[4] = control[4];
	if (this.enabled[dmaChannel] == this.DMA_REQUEST_TYPE.FIFO_A || this.enabled[dmaChannel] == this.DMA_REQUEST_TYPE.FIFO_B) {
		//Direct Sound DMA has some values hardwired:
		destinationShadow = 0x40000A0 | ((dmaChannel - 1) << 2);
		wordCountShadow = 4;
		controlShadow[2] = true;
		controlShadow[3] = control[3];
		controlShadow[5] = 2;
		if (this.enabled[dmaChannel] == this.DMA_REQUEST_TYPE.FIFO_A) {
			//Assert the FIFO A DMA request signal:
			this.IOCore.sound.checkFIFOAPendingSignal();
		}
		if (this.enabled[dmaChannel] == this.DMA_REQUEST_TYPE.FIFO_B) {
			//Assert the FIFO B DMA request signal:
			this.IOCore.sound.checkFIFOBPendingSignal();
		}
	}
	else if (this.enabled[dmaChannel] == this.DMA_REQUEST_TYPE.DISPLAY_SYNC) {
		//Display Sync DMA repeats until stopped by gfx hardware:
		controlShadow[2] = control[2];
		controlShadow[3] = true;
		controlShadow[5] = control[5];
	}
	else {
		//Flag immediate DMA transfers for processing now:
		if (this.enabled[dmaChannel] == this.DMA_REQUEST_TYPE.IMMEDIATE) {
			this.pending[dmaChannel] |= this.DMA_REQUEST_TYPE.IMMEDIATE;
			this.IOCore.systemStatus |= 0x1;
		}
		//Copy all of the internal to shadow:
		controlShadow[2] = control[2];
		controlShadow[3] = control[3];
		controlShadow[5] = control[5];
	}
	this.sourceShadow[dmaChannel] = sourceShadow;
	this.destinationShadow[dmaChannel] = destinationShadow;
	this.wordCountShadow[dmaChannel] = wordCountShadow;
}
GameBoyAdvanceDMA.prototype.soundFIFOARequest = function () {
	this.requestDMA(this.DMA_REQUEST_TYPE.FIFO_A);
}
GameBoyAdvanceDMA.prototype.soundFIFOBRequest = function () {
	this.requestDMA(this.DMA_REQUEST_TYPE.FIFO_B);
}
GameBoyAdvanceDMA.prototype.gfxHBlankRequest = function () {
	this.requestDMA(this.DMA_REQUEST_TYPE.H_BLANK);
}
GameBoyAdvanceDMA.prototype.gfxVBlankRequest = function () {
	this.requestDMA(this.DMA_REQUEST_TYPE.V_BLANK);
}
GameBoyAdvanceDMA.prototype.gfxDisplaySyncRequest = function () {
	this.requestDMA(this.DMA_REQUEST_TYPE.DISPLAY_SYNC);
}
GameBoyAdvanceDMA.prototype.gfxDisplaySyncKillRequest = function () {
	this.enabled[3] &= ~this.DMA_REQUEST_TYPE.DISPLAY_SYNC;
	this.pending[3] &= ~this.DMA_REQUEST_TYPE.DISPLAY_SYNC;
}
GameBoyAdvanceDMA.prototype.requestDMA = function (DMAType) {
	for (var dmaPriority = 0; dmaPriority < 4; ++dmaPriority) {
		if ((this.enabled[dmaPriority] & DMAType) != 0) {
			this.pending[dmaPriority] |= DMAType;
			this.IOCore.systemStatus |= 0x1;
		}
	}
}
GameBoyAdvanceDMA.prototype.requestGamePakDMA = function () {
	if (this.gamePakDMA) {
		//Game Pak transfer causes DMA to trigger:
		this.pending[3] |= this.DMA_REQUEST_TYPE.GAME_PAK;
		this.enabled[3] |= this.DMA_REQUEST_TYPE.GAME_PAK;
		this.IOCore.systemStatus |= 0x1;
	}
}
GameBoyAdvanceDMA.prototype.perform = function () {
	//Solve for the highest priority DMA to process:
	for (var dmaPriority = 0; dmaPriority < 4; ++dmaPriority) {
		this.currentMatch = this.enabled[dmaPriority] & this.pending[dmaPriority];
		if (this.currentMatch != 0) {
			if (this.currentMatch != this.lastCurrentMatch) {
				//Re-broadcasting on address bus, so non-seq:
				this.IOCore.wait.NonSequentialBroadcast();
				this.lastCurrentMatch = this.currentMatch;
			}
			this.handleDMACopy(dmaPriority);
			return false;
		}
	}
	//If no DMA was processed, then the DMA period has ended:
	this.lastCurrentMatch = -1;
	return true;
}
GameBoyAdvanceDMA.prototype.handleDMACopy = function (dmaChannel) {
	//Get the addesses:
	var source = this.sourceShadow[dmaChannel];
	var destination = this.destinationShadow[dmaChannel];
	//Load in the control register:
	var control = this.controlShadow[dmaChannel];
	//Transfer Data:
	if (control[2]) {
		//32-bit Transfer:
		this.memory.memoryWrite32(destination >>> 0, this.memory.memoryRead32(source >>> 0) | 0);
		this.decrementWordCount(control, dmaChannel | 0, source | 0, destination | 0, 4);
	}
	else {
		//16-bit Transfer:
		this.memory.memoryWrite16(destination >>> 0, this.memory.memoryRead16(source >>> 0) | 0);
		this.decrementWordCount(control, dmaChannel | 0, source | 0, destination | 0, 2);
	}
}
GameBoyAdvanceDMA.prototype.decrementWordCount = function (control, dmaChannel, source, destination, transferred) {
	var wordCountShadow = (this.wordCountShadow[dmaChannel] - 1) & ((dmaChannel < 3) ? 0x3FFF : 0xFFFF);
	if (wordCountShadow == 0) {
		if (!control[3]) {
			//Disable the enable bit:
			this.enabled[dmaChannel] = 0;
		}
		//Reload word count for DMA repeat:
		wordCountShadow = this.wordCount[dmaChannel];
		//DMA period has ended:
		this.pending[dmaChannel] -= this.currentMatch;
		//Assert the FIFO A DMA request signal:
		if (dmaChannel == 1 && this.currentMatch == this.DMA_REQUEST_TYPE.FIFO_A) {
			wordCountShadow = 4;
			this.IOCore.sound.checkFIFOAPendingSignal();
		}
		//Assert the FIFO B DMA request signal:
		if (dmaChannel == 2 && this.currentMatch == this.DMA_REQUEST_TYPE.FIFO_B) {
			wordCountShadow = 4;
			this.IOCore.sound.checkFIFOBPendingSignal();
		}
		//Check to see if we should flag for IRQ:
		if (control[0]) {
			var dmaIRQFlag = 0x100;
			switch (dmaChannel) {
				case 3:
					dmaIRQFlag <<= 1;
				case 2:
					dmaIRQFlag <<= 1;
				case 1:
					dmaIRQFlag <<= 1;
			}
			this.IOCore.irq.requestIRQ(dmaIRQFlag);
		}
		//Update source address:
		switch (control[4]) {
			case 0:	//Increment
				this.sourceShadow[dmaChannel] = (source + transferred) | 0;
				break;
			case 1:	//Decrement
				this.sourceShadow[dmaChannel] = (source - transferred) | 0;
				break;
			case 3:	//Reload
				//Prohibited code, should not get here:
				this.sourceShadow[dmaChannel] = this.source[dmaChannel];
		}
		//Update destination address:
		switch (control[5]) {
			case 0:	//Increment
				this.destinationShadow[dmaChannel] = (destination + transferred) | 0;
				break;
			case 1:	//Decrement
				this.destinationShadow[dmaChannel] = (destination - transferred) | 0;
				break;
			case 3:	//Reload
				this.destinationShadow[dmaChannel] = this.destination[dmaChannel];
		}
	}
	else {
		//Update source address:
		switch (control[4]) {
			case 0:	//Increment
			case 3:	//Prohibited code...
				this.sourceShadow[dmaChannel] = (source + transferred) | 0;
				break;
			case 1:
				this.sourceShadow[dmaChannel] = (source - transferred) | 0;
		}
		//Update destination address:
		switch (control[5]) {
			case 0:	//Increment
			case 3:	//Increment
				this.destinationShadow[dmaChannel] = (destination + transferred) | 0;
				break;
			case 1:	//Decrement
				this.destinationShadow[dmaChannel] = (destination - transferred) | 0;
		}
	}
	//Save the new word count:
	this.wordCountShadow[dmaChannel] = wordCountShadow;
}
GameBoyAdvanceDMA.prototype.nextEventTime = function () {
	var clocks = -1;
	var workbench = -1;
	for (var dmaChannel = 0; dmaChannel < 4; ++dmaChannel) {
		switch (this.enabled[dmaChannel] & 0x3F) {
			//V_BLANK
			case 0x2:
				workbench = this.IOCore.gfx.nextVBlankEventTime();
				break;
			//H_BLANK:
			case 0x4:
				workbench = this.IOCore.gfx.nextHBlankDMAEventTime();
				break;
			//FIFO_A:
			case 0x8:
				workbench = this.IOCore.sound.nextFIFOAEventTime();
				break;
			//FIFO_B:
			case 0x10:
				workbench = this.IOCore.sound.nextFIFOBEventTime();
				break;
			//DISPLAY_SYNC:
			case 0x20:
				workbench = this.IOCore.gfx.nextDisplaySyncEventTime();
		}
		clocks = (clocks > -1) ? ((workbench > -1) ? Math.min(clocks, workbench) : clocks) : workbench;
	}
	return clocks | 0;
}
GameBoyAdvanceDMA.prototype.nextIRQEventTime = function (dmaChannel) {
	var clocks = -1;
	if (this.controlShadow[dmaChannel][0]) {
		switch (this.enabled[dmaChannel] & 0x3F) {
			//V_BLANK
			case 0x2:
				clocks = this.IOCore.gfx.nextVBlankEventTime();
				break;
			//H_BLANK:
			case 0x4:
				clocks = this.IOCore.gfx.nextHBlankDMAEventTime();
				break;
			//FIFO_A:
			case 0x8:
				clocks = this.IOCore.sound.nextFIFOAEventTime();
				break;
			//FIFO_B:
			case 0x10:
				clocks = this.IOCore.sound.nextFIFOBEventTime();
				break;
			//DISPLAY_SYNC:
			case 0x20:
				clocks = this.IOCore.gfx.nextDisplaySyncEventTime();
		}
	}
	return clocks | 0;
}
GameBoyAdvanceDMA.prototype.nextDMA0IRQEventTime = function () {
	return this.nextIRQEventTime(0);
}
GameBoyAdvanceDMA.prototype.nextDMA1IRQEventTime = function () {
	return this.nextIRQEventTime(1);
}
GameBoyAdvanceDMA.prototype.nextDMA2IRQEventTime = function () {
	return this.nextIRQEventTime(2);
}
GameBoyAdvanceDMA.prototype.nextDMA3IRQEventTime = function () {
	return this.nextIRQEventTime(3);
}