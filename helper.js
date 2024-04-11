/**
 * Copyright (c) 2024 dmkng
 *
 * This file is part of MoreloBOT.
 *
 * MoreloBOT is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * MoreloBOT is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with MoreloBOT.  If not, see <https://www.gnu.org/licenses/>.
 */

export default {
	getDate() {
		const date = new Date();
		return date.getFullYear() + "-"
			+ ("0" + date.getMonth()).slice(-2) + "-"
			+ ("0" + date.getDate()).slice(-2) + " "
			+ ("0" + date.getHours()).slice(-2) + ":"
			+ ("0" + date.getMinutes()).slice(-2) + ":"
			+ ("0" + date.getSeconds()).slice(-2) + "."
			+ ("00" + date.getMilliseconds()).slice(-3);
	},
	log(format, ...args) {
		console.log("\x1B[32m[%s]\x1B[0m " + format, this.getDate(), ...args);
	},
	err(format, ...args) {
		console.error("\x1B[31m[%s]\x1B[0m " + format, this.getDate(), ...args);
	},
	warn(format, ...args) {
		console.warn("\x1B[33m[%s]\x1B[0m " + format, this.getDate(), ...args);
	},
	dbg(format, ...args) {
		console.debug("\x1B[34m[%s]\x1B[0m " + format, this.getDate(), ...args);
	}
};
